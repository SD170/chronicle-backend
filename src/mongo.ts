// src/mongo.ts
import mongoose from 'mongoose';
import { ENV } from './config.ts';

export async function connectMongo() {
  await mongoose.connect(ENV.MONGO_URI, { dbName: 'echorun' });
  console.log('Mongo connected');
}
