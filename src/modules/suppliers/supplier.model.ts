import { type HydratedDocument, type InferSchemaType, model, Schema } from 'mongoose';
import { normalizeText } from '../../common/utils/text.js';
import { jsonOptions } from '../../db/schema-options.js';

const supplierSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    searchName: { type: String, required: true },
    contactName: { type: String, trim: true, maxlength: 120, default: '' },
    phone: { type: String, trim: true, maxlength: 30, default: '' },
    email: { type: String, trim: true, lowercase: true, maxlength: 120, default: '' },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

supplierSchema.index({ businessId: 1, searchName: 1 }, { unique: true });

export type SupplierData = InferSchemaType<typeof supplierSchema>;
export type SupplierDocument = HydratedDocument<SupplierData>;

supplierSchema.pre('validate', function (this: SupplierDocument) {
  this.searchName = normalizeText(this.name);
});

export const Supplier = model('Supplier', supplierSchema);
