/**
 * Datos de demostración de una marisquería (solo desarrollo/pruebas; nunca en producción).
 * Usuarios: demo.root (superadmin), demo.admin (admin), demo.caja (empleado) — clave Demo12345.
 */
import { hashPassword } from '../modules/auth/password.js';
import { Business } from '../modules/businesses/business.model.js';
import { Category } from '../modules/categories/category.model.js';
import { createProduct } from '../modules/products/product.service.js';
import { Supplier } from '../modules/suppliers/supplier.model.js';
import { User } from '../modules/users/user.model.js';

export const DEMO_PASSWORD = 'Demo12345';

type Unit = 'pz' | 'kg' | 'l';
type TaxRate = 0 | 800 | 1600;
type DemoProduct = [
  code: string,
  name: string,
  category: string,
  unit: Unit,
  price: number,
  cost: number,
  stock: number,
  min: number,
  taxRateBp: TaxRate,
  barcode?: string,
];

const KG = 1000;
const PRODUCTS: DemoProduct[] = [
  ['101', 'Camarón grande U-15', 'Mariscos frescos', 'kg', 38900, 29000, 18.5 * KG, 5 * KG, 0],
  ['102', 'Camarón mediano 41-50', 'Mariscos frescos', 'kg', 25900, 18500, 22 * KG, 5 * KG, 0],
  ['103', 'Pulpo cocido', 'Mariscos frescos', 'kg', 32900, 24000, 3.2 * KG, 4 * KG, 0],
  ['104', 'Callo de hacha', 'Mariscos frescos', 'kg', 89000, 68000, 1.15 * KG, 1 * KG, 0],
  ['105', 'Jaiba suave', 'Mariscos frescos', 'kg', 28000, 19000, 0, 2 * KG, 0],
  ['106', 'Ostión en concha (docena)', 'Mariscos frescos', 'pz', 18000, 11000, 24, 6, 0],
  ['201', 'Filete de tilapia', 'Pescados', 'kg', 13900, 9200, 25 * KG, 8 * KG, 0],
  ['202', 'Filete de huachinango', 'Pescados', 'kg', 28900, 21000, 6.4 * KG, 3 * KG, 0],
  ['203', 'Atún aleta amarilla', 'Pescados', 'kg', 34900, 25500, 4 * KG, 2 * KG, 0],
  ['301', 'Coctel de camarón grande', 'Cocteles y preparados', 'pz', 18500, 7500, 40, 0, 1600],
  ['302', 'Aguachile verde (orden)', 'Cocteles y preparados', 'pz', 21000, 8500, 30, 0, 1600],
  ['401', 'Clamato 946 ml', 'Bebidas', 'pz', 6800, 4200, 36, 12, 1600, '7501000000017'],
  ['402', 'Cerveza clara 355 ml', 'Bebidas', 'pz', 3200, 1900, 120, 48, 1600, '7501000000024'],
  ['403', 'Agua mineral 600 ml', 'Bebidas', 'pz', 2500, 1300, 10, 24, 1600, '7501000000031'],
  ['501', 'Salsa huichol 190 ml', 'Abarrotes', 'pz', 3800, 2200, 18, 6, 1600, '7501000000048'],
  ['502', 'Galletas saladas', 'Abarrotes', 'pz', 3200, 2000, 14, 0, 1600],
  ['503', 'Limón', 'Abarrotes', 'kg', 4500, 2800, 12 * KG, 3 * KG, 0],
];

export async function seedDemo(): Promise<void> {
  if (await User.exists({ username: 'demo.root' })) return;
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  await User.create({
    name: 'Raúl Superadmin',
    username: 'demo.root',
    passwordHash,
    role: 'superadmin',
  });
  const faro = await Business.create({
    name: 'Mariscos El Faro',
    legalName: 'Mariscos El Faro S.A. de C.V.',
    taxId: 'MEF010101AB1',
    phone: '322 555 0101',
    address: 'Malecón 120, Puerto Vallarta, Jal.',
  });
  await Business.create({ name: 'Abarrotes La Esquina', phone: '33 1234 5678' });

  const admin = await User.create({
    name: 'Ana Ruiz',
    username: 'demo.admin',
    passwordHash,
    role: 'admin',
    businessId: faro._id,
  });
  await User.create({
    name: 'Carlos Méndez',
    username: 'demo.caja',
    passwordHash,
    role: 'employee',
    businessId: faro._id,
  });

  const categoryNames = [...new Set(PRODUCTS.map((p) => p[2]))];
  const categories = await Category.insertMany(
    categoryNames.map((name) => ({ businessId: faro._id, name, searchName: name.toLowerCase() })),
  );
  const categoryId = (name: string) => categories.find((c) => c.name === name)?.id as string;

  await Supplier.insertMany([
    {
      businessId: faro._id,
      name: 'Pescadería del Puerto',
      searchName: 'pescaderia del puerto',
      contactName: 'Don Memo',
      phone: '322 111 2233',
    },
    {
      businessId: faro._id,
      name: 'Distribuidora Bahía',
      searchName: 'distribuidora bahia',
      contactName: 'Lupita',
      phone: '33 4455 6677',
      email: 'ventas@bahia.example',
    },
  ]);

  const actor = { id: admin.id as string, name: admin.name };
  for (const [
    code,
    name,
    category,
    unit,
    price,
    cost,
    stock,
    min,
    taxRateBp,
    barcode,
  ] of PRODUCTS) {
    await createProduct(faro.id as string, actor, {
      code,
      name,
      unit,
      categoryId: categoryId(category),
      salePriceCents: price,
      costCents: cost,
      initialStock: Math.round(stock),
      minStock: Math.round(min),
      taxRateBp,
      ...(barcode && { barcode }),
    });
  }
}
