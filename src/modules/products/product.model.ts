import { type HydratedDocument, type InferSchemaType, model, Schema } from 'mongoose';
import { UNIT_CODES } from '../../common/utils/qty.js';
import { normalizeText } from '../../common/utils/text.js';
import { jsonOptions } from '../../db/schema-options.js';

/** Tasas de IVA en basis points: exento/0 %, frontera 8 %, general 16 %. Los precios YA las incluyen. */
export const TAX_RATES_BP = [0, 800, 1600] as const;

const integer = { validator: Number.isSafeInteger, message: '{PATH} debe ser un entero' };

const productSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    /** Código corto para teclear rápido en caja (tipo PLU): "101", "CAM-G". */
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    /** Código de barras opcional. Ausente (no "") cuando no hay. */
    barcode: { type: String, trim: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    searchName: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    /** Unidad de venta: pz | kg | l. Cantidades en unidad base (pz, g, ml). */
    unit: { type: String, enum: UNIT_CODES, required: true },
    /** Precio por unidad de venta (por pieza, por kg, por litro), IVA incluido. */
    salePriceCents: { type: Number, required: true, min: 0, validate: integer },
    /** Costo promedio ponderado por unidad de venta. */
    costCents: { type: Number, default: 0, min: 0, validate: integer },
    taxRateBp: { type: Number, enum: TAX_RATES_BP, default: 1600 },
    /** Existencia en unidad base; solo cambia mediante movimientos de inventario. */
    stock: { type: Number, default: 0, validate: integer },
    minStock: { type: Number, default: 0, min: 0, validate: integer },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: jsonOptions },
);

productSchema.index({ businessId: 1, code: 1 }, { unique: true });
productSchema.index(
  { businessId: 1, barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } },
);
productSchema.index({ businessId: 1, searchName: 1 });
productSchema.index({ businessId: 1, categoryId: 1 });

export type ProductData = InferSchemaType<typeof productSchema>;
export type ProductDocument = HydratedDocument<ProductData>;

productSchema.pre('validate', function (this: ProductDocument) {
  this.searchName = normalizeText(this.name);
});

export const Product = model('Product', productSchema);
