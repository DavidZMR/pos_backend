import { type HydratedDocument, type InferSchemaType, model, Schema } from 'mongoose';
import { normalizeText } from '../../common/utils/text.js';
import { jsonOptions } from '../../db/schema-options.js';

export const DEFAULT_TIMEZONE = 'America/Mexico_City';

const businessSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    searchName: { type: String, index: true },
    legalName: { type: String, trim: true, maxlength: 160 },
    /** RFC u otro identificador fiscal (solo informativo). */
    taxId: { type: String, trim: true, uppercase: true, maxlength: 20 },
    phone: { type: String, trim: true, maxlength: 30 },
    address: { type: String, trim: true, maxlength: 250 },
    timezone: { type: String, default: DEFAULT_TIMEZONE },
    ticket: {
      header: { type: String, default: '', maxlength: 500 },
      footer: { type: String, default: '', maxlength: 500 },
    },
    settings: {
      allowNegativeStock: { type: Boolean, default: true },
    },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

export type BusinessData = InferSchemaType<typeof businessSchema>;
export type BusinessDocument = HydratedDocument<BusinessData>;

businessSchema.pre('validate', function (this: BusinessDocument) {
  this.searchName = normalizeText(this.name);
});

export const Business = model('Business', businessSchema);
