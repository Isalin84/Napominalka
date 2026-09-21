const {app} = require('electron');
const path = require('node:path');
if (!process.env.NAPOMINALKA_QA_PROFILE) throw new Error('An isolated QA profile is required');
app.setPath('userData',process.env.NAPOMINALKA_QA_PROFILE);
app.setPath('appData',process.env.NAPOMINALKA_QA_PROFILE);
require(path.join(__dirname,'..','main.cjs'));
