const appDatabase = db.getSiblingDB('teaching_quality');
appDatabase.createUser({
  user: process.env.MONGO_APP_USERNAME,
  pwd: process.env.MONGO_APP_PASSWORD,
  roles: [{ role: 'readWrite', db: 'teaching_quality' }]
});
