// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright package.
// Uses an isolated profile; never touches the user's reminders or history.
const {_electron: electron} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(),'napominalka-qa-'));
const output = path.join(root,'output/playwright');
fs.mkdirSync(output,{recursive:true});
let app;
async function waitState(page, predicate) {
  for (let attempt=0; attempt<80; attempt++) {
    const state=await page.evaluate(()=>window.desktopApi.getState());
    if(predicate(state))return state;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error('State did not reach expected value');
}
async function launch() {
  app = await electron.launch({executablePath:require('electron'),args:[path.join(root,'scripts/qa-entry.cjs')],env:{...process.env,NAPOMINALKA_QA_PROFILE:profile}});
  const page = await app.firstWindow();
  page.on('pageerror',e=>{throw e;});
  await page.waitForFunction(()=>document.querySelector('#sidebar-pet-card').children.length>0);
  return page;
}
(async()=>{
  let page = await launch();
  await page.locator('[data-onboarding-pet="winnie"]').click();
  await page.locator('#onboarding-continue').click();
  await page.locator('#onboarding.is-hidden').waitFor({state:'attached'});
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.locator('.window-action').first().isVisible(),process.platform!=='darwin');
  if(process.platform==='darwin') assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getWindowButtonPosition()),{x:20,y:20});
  await page.screenshot({path:path.join(output,'overview.png')});
  await page.locator('.nav-item[data-view="exercises"]').click();
  assert.equal(await page.locator('.exercise-card').count(),3);
  await page.locator('[data-log-exercise="squats"] input').fill('17');
  await page.locator('[data-log-exercise="squats"] button').click();
  await page.waitForFunction(()=>document.querySelector('.exercise-value strong').textContent==='17');
  await page.locator('[data-edit-exercise="squats"]').click();
  await page.locator('#exercise-form [name=target]').fill('40');
  await page.locator('#exercise-form [type=submit]').click();
  await page.waitForFunction(()=>!document.querySelector('#exercise-dialog').open);
  await page.locator('#add-exercise').click();
  await page.locator('#exercise-form [name=name]').fill('Планка');
  await page.locator('#exercise-form [name=unit]').selectOption('seconds');
  await page.locator('#exercise-form [name=target]').fill('120');
  await page.locator('#exercise-form [name=perSet]').fill('30');
  await page.locator('#exercise-form [type=submit]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.exercise-card').length===4);
  await page.screenshot({path:path.join(output,'exercises.png')});
  let state = await page.evaluate(()=>window.desktopApi.getState());
  assert.equal(state.exerciseLog[0].amount,17);
  assert.equal(state.exercises[0].target,40);
  assert.equal(state.exercises[3].unit,'seconds');
  const stale = structuredClone(state);
  await page.evaluate(()=>window.desktopApi.logExercise({exerciseId:'pushups',amount:7}));
  state=await page.evaluate(s=>window.desktopApi.saveState(s),stale);
  assert.equal(state.exerciseLog.length,2,'stale settings save must retain logs');
  await assert.rejects(page.evaluate(()=>window.desktopApi.logExercise({exerciseId:'squats',amount:-1})));
  const popupPromise=app.waitForEvent('window');
  await page.evaluate(()=>window.desktopApi.testReminder('movement'));
  const popup=await popupPromise;
  await popup.locator('#popup-amount-row:not([hidden])').waitFor();
  await popup.locator('#popup-amount').fill('8');
  await popup.screenshot({path:path.join(output,'popup.png')});
  await popup.locator('#popup-complete').click();
  state=await waitState(page,s=>s.exerciseLog.length===3);
  assert.equal(state.exerciseLog[2].amount,8);
  await page.locator('[data-undo-exercise]').first().click();
  await waitState(page,s=>s.exerciseLog.length===2);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>!w.webContents.getURL().includes('popup')).setSize(960,680));
  await page.screenshot({path:path.join(output,'exercises-small.png')});
  for (const view of ['reminders','settings','history']) {
    await page.locator(`.nav-item[data-view="${view}"]`).click();
    await page.screenshot({path:path.join(output,`${view}.png`)});
  }
  await app.close();
  page=await launch();
  state=await page.evaluate(()=>window.desktopApi.getState());
  assert.equal(state.exercises.length,4,'exercises survive restart');
  assert.equal(state.exerciseLog.length,2,'logs survive restart');
  assert.equal(state.exercises[0].target,40,'targets survive restart');
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false,'close hides settings and retains app');
  console.log('PASS: onboarding, macOS controls, exercise logging/editing/custom seconds, stale save, invalid input, popup actual counts, undo and restart persistence.');
  console.log('Screenshots:',output);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
