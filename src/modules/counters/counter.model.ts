import { type ClientSession, model, Schema } from 'mongoose';

/** Folios consecutivos por negocio y tipo de documento (compras, ventas, cortes…). */
const counterSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    key: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

counterSchema.index({ businessId: 1, key: 1 }, { unique: true });

export const Counter = model('Counter', counterSchema);

export type CounterKey = 'purchase' | 'sale' | 'cash-session';

/** Siguiente folio (1, 2, 3…). Dentro de la transacción del documento que lo usa. */
export async function nextSequence(
  businessId: string,
  key: CounterKey,
  session?: ClientSession,
): Promise<number> {
  const counter = await Counter.findOneAndUpdate(
    { businessId, key },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session },
  );
  return counter.seq;
}
