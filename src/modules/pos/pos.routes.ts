import { Router } from 'express';
import { sendOk } from '../../common/http/response.js';
import { authenticate } from '../auth/auth.middleware.js';
import { requireBusinessId, resolveTenant } from '../auth/tenant.middleware.js';
import { Category } from '../categories/category.model.js';
import { Product } from '../products/product.model.js';

/**
 * Catálogo ligero para la pantalla de venta (todos los roles, incluido empleado).
 * La caja lo carga completo y busca en memoria: resultados instantáneos mientras se teclea.
 */
export const posRouter = Router();

posRouter.use(authenticate, resolveTenant());

posRouter.get('/catalog', async (req, res) => {
  const businessId = requireBusinessId(req);
  const [products, categories] = await Promise.all([
    Product.find({ businessId, active: true })
      .select('code barcode name categoryId unit salePriceCents taxRateBp stock minStock')
      .sort({ searchName: 1 })
      .lean(),
    Category.find({ businessId, active: true }).select('name').sort({ searchName: 1 }).lean(),
  ]);
  sendOk(res, {
    products: products.map(({ _id, ...p }) => ({ id: String(_id), ...p })),
    categories: categories.map((c) => ({ id: String(c._id), name: c.name })),
    loadedAt: new Date().toISOString(),
  });
});
