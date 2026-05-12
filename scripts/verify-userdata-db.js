const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const project = process.cwd();
const dbModulePath = path.join(project, 'dist', 'main', 'main', 'database.js');
const { getDbPath, initDatabase, closeDatabase } = require(dbModulePath);

app.setName('Exocad Serial Manager');

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  const dbPath = getDbPath();
  initDatabase();

  const result = {
    userData,
    dbPath,
    dbUnderUserData: dbPath.startsWith(userData),
    dbExists: fs.existsSync(dbPath),
  };

  console.log(JSON.stringify(result, null, 2));
  closeDatabase();
  app.quit();
}).catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  app.exit(1);
});
