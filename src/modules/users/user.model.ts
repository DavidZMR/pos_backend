import { type HydratedDocument, type InferSchemaType, model, Schema } from 'mongoose';
import { normalizeText } from '../../common/utils/text.js';
import { jsonOptions } from '../../db/schema-options.js';

export const ROLES = ['superadmin', 'admin', 'employee'] as const;
export type Role = (typeof ROLES)[number];

export const USERNAME_PATTERN = /^[a-z0-9._-]+$/;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    searchName: { type: String, index: true },
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      minlength: 3,
      maxlength: 40,
      match: USERNAME_PATTERN,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    /** null solo para superadmin. */
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', default: null, index: true },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: jsonOptions },
);

export type UserData = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<UserData>;

userSchema.pre('validate', function (this: UserDocument) {
  this.searchName = normalizeText(`${this.name} ${this.username}`);
  if (this.role === 'superadmin') {
    this.businessId = null;
  } else if (!this.businessId) {
    this.invalidate('businessId', 'El usuario debe pertenecer a un negocio');
  }
});

export const User = model('User', userSchema);
