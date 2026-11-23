import { type HydratedDocument, type InferSchemaType, model, Schema } from 'mongoose';
import { normalizeText } from '../../common/utils/text.js';
import { jsonOptions } from '../../db/schema-options.js';

const categorySchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    searchName: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

// Único por negocio sin importar mayúsculas/acentos ("Mariscos" = "mariscos").
categorySchema.index({ businessId: 1, searchName: 1 }, { unique: true });

export type CategoryData = InferSchemaType<typeof categorySchema>;
export type CategoryDocument = HydratedDocument<CategoryData>;

categorySchema.pre('validate', function (this: CategoryDocument) {
  this.searchName = normalizeText(this.name);
});

export const Category = model('Category', categorySchema);
