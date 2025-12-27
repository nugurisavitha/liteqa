/**
 * LiteQA Database Module
 * MongoDB connection and models for persistent storage
 */

import mongoose, { Schema, Document } from 'mongoose';

// ============================================================================
// Database Connection
// ============================================================================

let isConnected = false;

export async function connectDatabase(): Promise<void> {
  if (isConnected) return;

  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URL;

  if (!mongoUri) {
    console.warn('[DB] No MongoDB URI provided. Using file-based storage.');
    return;
  }

  try {
    await mongoose.connect(mongoUri);
    isConnected = true;
    console.log('[DB] Connected to MongoDB');
  } catch (error) {
    console.error('[DB] MongoDB connection failed:', error);
    throw error;
  }
}

export function isDatabaseConnected(): boolean {
  return isConnected;
}

// ============================================================================
// Project Model
// ============================================================================

export interface IProject extends Document {
  name: string;
  displayName: string;
  description?: string;
  baseUrl?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectSchema = new Schema<IProject>({
  name: { type: String, required: true, unique: true, index: true },
  displayName: { type: String, required: true },
  description: { type: String },
  baseUrl: { type: String },
}, { timestamps: true });

export const Project = mongoose.model<IProject>('Project', ProjectSchema);

// ============================================================================
// Flow Model
// ============================================================================

export interface IFlow extends Document {
  projectName: string;
  fileName: string;
  name: string;
  description?: string;
  runner: string;
  content: string; // YAML content
  steps: any[];
  createdAt: Date;
  updatedAt: Date;
}

const FlowSchema = new Schema<IFlow>({
  projectName: { type: String, required: true, index: true },
  fileName: { type: String, required: true },
  name: { type: String, required: true },
  description: { type: String },
  runner: { type: String, default: 'web' },
  content: { type: String, required: true },
  steps: { type: Schema.Types.Mixed, default: [] },
}, { timestamps: true });

FlowSchema.index({ projectName: 1, fileName: 1 }, { unique: true });

export const Flow = mongoose.model<IFlow>('Flow', FlowSchema);

// ============================================================================
// Report Model
// ============================================================================

export interface IReport extends Document {
  projectName: string;
  fileName: string;
  type: 'functional' | 'load' | 'page' | 'api';
  name: string;
  description?: string;
  status: 'passed' | 'failed';
  content: any; // Full report JSON
  timestamp: Date;
  duration?: number;
  totalSteps?: number;
  passedSteps?: number;
  failedSteps?: number;
  metrics?: any;
  createdAt: Date;
}

const ReportSchema = new Schema<IReport>({
  projectName: { type: String, required: true, index: true },
  fileName: { type: String, required: true },
  type: { type: String, enum: ['functional', 'load', 'page', 'api'], default: 'functional' },
  name: { type: String, required: true },
  description: { type: String },
  status: { type: String, enum: ['passed', 'failed'], default: 'passed' },
  content: { type: Schema.Types.Mixed, required: true },
  timestamp: { type: Date, default: Date.now, index: true },
  duration: { type: Number },
  totalSteps: { type: Number },
  passedSteps: { type: Number },
  failedSteps: { type: Number },
  metrics: { type: Schema.Types.Mixed },
}, { timestamps: true });

ReportSchema.index({ projectName: 1, fileName: 1 }, { unique: true });
ReportSchema.index({ projectName: 1, type: 1 });

export const Report = mongoose.model<IReport>('Report', ReportSchema);

// ============================================================================
// Repository Model (Object Repository)
// ============================================================================

export interface IRepository extends Document {
  projectName: string;
  content: string; // YAML content
  pages: any;
  updatedAt: Date;
}

const RepositorySchema = new Schema<IRepository>({
  projectName: { type: String, required: true, unique: true, index: true },
  content: { type: String, default: '' },
  pages: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });

export const Repository = mongoose.model<IRepository>('Repository', RepositorySchema);

// ============================================================================
// Suite Model
// ============================================================================

export interface ISuite extends Document {
  projectName: string;
  name: string;
  description?: string;
  flows: string[];
  env: any;
  content: string; // YAML content
  updatedAt: Date;
}

const SuiteSchema = new Schema<ISuite>({
  projectName: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  description: { type: String },
  flows: { type: [String], default: [] },
  env: { type: Schema.Types.Mixed, default: {} },
  content: { type: String, default: '' },
}, { timestamps: true });

export const Suite = mongoose.model<ISuite>('Suite', SuiteSchema);
