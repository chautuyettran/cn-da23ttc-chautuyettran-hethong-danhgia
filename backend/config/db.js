const mongoose = require('mongoose');

async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error('MONGODB_URI is required.');
  mongoose.set('strictQuery', true);
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 3000,
        maxPoolSize: 10,
        autoIndex: false
      });
      const hello = await mongoose.connection.db.admin().command({ hello: 1 });
      if (!hello.setName || !hello.isWritablePrimary) {
        throw new Error('MongoDB must be available as a writable replica-set primary to support atomic survey submissions.');
      }
      return mongoose.connection;
    } catch (error) {
      lastError = error;
      await mongoose.disconnect();
      if (attempt < 30) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const error = new Error('MongoDB is unavailable after 30 connection attempts.');
  error.cause = lastError;
  throw error;
}

module.exports = { connectDatabase, mongoose };
