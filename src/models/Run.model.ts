// src/models/Run.ts
import mongoose from 'mongoose';

const RunSchema = new mongoose.Schema({
  player_id: { type: String, index: true, required: true },
  session_id: { type: String, required: true },
  run_index: { type: Number, required: true },
  completed_at: { type: String, required: true },
  result: { type: String, enum: ['win','loss'], required: true },
  path: { type: String, enum: ['combat','puzzle','exploration'], required: true },
  stats_json: { type: Object, required: true },
  config_json: { type: Object, required: true },
  events_digest: { type: Array, default: [] }
}, { timestamps: true });

RunSchema.index({ player_id: 1, run_index: -1 });

export const RunModel = mongoose.model('runs', RunSchema);
