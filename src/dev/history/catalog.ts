/**
 * Catálogo ficticio para el historial de pruebas: productos extra y el "perfil" de demanda de
 * cada producto (qué tan seguido se vende, cuánto se lleva el cliente, quién lo surte).
 */

type Unit = 'pz' | 'kg' | 'l';
type TaxRate = 0 | 800 | 1600;

export type SupplierKey = 'puerto' | 'bahia' | 'congeladora' | 'verduras' | 'esquina';

export interface DemandProfile {
  /** Popularidad relativa (más alto = aparece en más tickets). */
  weight: number;
  /** Cantidad por renglón en unidad base (g, ml o piezas) y su paso. */
  qtyMin: number;
  qtyMax: number;
  step: number;
  /** Quién lo surte; null = se prepara en cocina ("producción del día", no es compra). */
  supplier: SupplierKey | null;
  /** Cambios manuales de precio: meses atrás desde hoy → nuevo precio en centavos. */
  priceChanges?: { monthsAgo: number; priceCents: number }[];
}

export type ExtraProduct = [
  code: string,
  name: string,
  category: string,
  unit: Unit,
  priceCents: number,
  costCents: number,
  initialStock: number,
  minStock: number,
  taxRateBp: TaxRate,
];

const KG = 1000;
const kg = (min: number, max: number, step = 250, weight = 1, supplier: SupplierKey = 'puerto') =>
  ({ weight, qtyMin: min * KG, qtyMax: max * KG, step, supplier }) satisfies DemandProfile;
const pz = (min: number, max: number, weight = 1, supplier: SupplierKey | null = 'bahia') =>
  ({ weight, qtyMin: min, qtyMax: max, step: 1, supplier }) satisfies DemandProfile;

/** Productos que se agregan a El Atlántico además de los 17 de la demo. */
export const ATLANTICO_EXTRA: ExtraProduct[] = [
  ['107', 'Langostino', 'Mariscos frescos', 'kg', 42000, 31000, 6 * KG, 2 * KG, 0],
  ['108', 'Almeja chocolata (docena)', 'Mariscos frescos', 'pz', 16000, 10000, 20, 6, 0],
  ['109', 'Mejillón', 'Mariscos frescos', 'kg', 12000, 7800, 8 * KG, 2 * KG, 0],
  ['110', 'Calamar limpio', 'Mariscos frescos', 'kg', 16900, 11500, 10 * KG, 3 * KG, 0],
  ['111', 'Pulpo crudo', 'Mariscos frescos', 'kg', 26900, 19500, 6 * KG, 2 * KG, 0],
  ['112', 'Camarón cocido pelado', 'Mariscos frescos', 'kg', 34900, 26000, 8 * KG, 3 * KG, 0],
  ['113', 'Surimi', 'Mariscos frescos', 'kg', 9900, 6200, 6 * KG, 2 * KG, 0],
  ['204', 'Filete de robalo', 'Pescados', 'kg', 32900, 24500, 6 * KG, 2 * KG, 0],
  ['205', 'Mojarra entera', 'Pescados', 'kg', 11900, 8000, 15 * KG, 5 * KG, 0],
  ['206', 'Filete de sierra', 'Pescados', 'kg', 15900, 10900, 8 * KG, 3 * KG, 0],
  ['207', 'Filete de salmón', 'Pescados', 'kg', 49900, 38000, 5 * KG, 2 * KG, 0],
  ['208', 'Marlín ahumado', 'Pescados', 'kg', 39900, 28000, 3 * KG, 1 * KG, 0],
  ['209', 'Cazón', 'Pescados', 'kg', 13900, 9500, 5 * KG, 2 * KG, 0],
  ['303', 'Tostada de ceviche', 'Cocteles y preparados', 'pz', 4500, 1800, 60, 0, 1600],
  ['304', 'Campechana (vaso)', 'Cocteles y preparados', 'pz', 22000, 9500, 20, 0, 1600],
  ['305', 'Ceviche de pescado (orden)', 'Cocteles y preparados', 'pz', 16500, 6500, 25, 0, 1600],
  ['306', 'Caldo de camarón', 'Cocteles y preparados', 'pz', 14500, 5500, 20, 0, 1600],
  ['307', 'Pescado zarandeado', 'Cocteles y preparados', 'kg', 35000, 16000, 8 * KG, 0, 1600],
  ['404', 'Refresco 600 ml', 'Bebidas', 'pz', 2200, 1300, 72, 24, 1600],
  ['405', 'Michelada preparada', 'Bebidas', 'pz', 8500, 3200, 40, 0, 1600],
  ['406', 'Agua de horchata', 'Bebidas', 'l', 4500, 1500, 20 * KG, 5 * KG, 0],
  ['407', 'Cerveza oscura 355 ml', 'Bebidas', 'pz', 3500, 2100, 96, 24, 1600],
  ['504', 'Tostadas de maíz (paquete)', 'Abarrotes', 'pz', 3500, 2000, 30, 10, 0],
  ['505', 'Salsa Valentina 370 ml', 'Abarrotes', 'pz', 2800, 1600, 24, 6, 1600],
  ['506', 'Mayonesa 390 g', 'Abarrotes', 'pz', 5200, 3400, 12, 4, 1600],
  ['507', 'Cebolla morada', 'Abarrotes', 'kg', 3800, 2200, 8 * KG, 2 * KG, 0],
  ['508', 'Aguacate', 'Abarrotes', 'kg', 7900, 5200, 10 * KG, 3 * KG, 0],
  ['509', 'Cilantro (manojo)', 'Abarrotes', 'pz', 1000, 500, 30, 10, 0],
  ['601', 'Camarón empanizado congelado 1 kg', 'Congelados', 'pz', 21000, 14500, 15, 5, 1600],
  ['602', 'Filete empanizado congelado 500 g', 'Congelados', 'pz', 8900, 5800, 20, 6, 1600],
];

/** Perfil de demanda por código (los 17 de la demo + los extra). */
export const ATLANTICO_PROFILES: Record<string, DemandProfile> = {
  '101': {
    ...kg(0.25, 2, 250, 10),
    priceChanges: [
      { monthsAgo: 9, priceCents: 41500 },
      { monthsAgo: 3, priceCents: 42900 },
    ],
  },
  '102': kg(0.25, 2, 250, 12),
  '103': kg(0.25, 1.5, 250, 4),
  '104': kg(0.1, 0.75, 50, 2),
  '105': kg(0.25, 1, 250, 2),
  '106': pz(1, 3, 4, 'puerto'),
  '201': { ...kg(0.5, 2, 250, 9), priceChanges: [{ monthsAgo: 8, priceCents: 14900 }] },
  '202': kg(0.5, 1.5, 250, 4),
  '203': kg(0.25, 1, 250, 3),
  '301': pz(1, 3, 9, null),
  '302': pz(1, 2, 6, null),
  '401': pz(1, 3, 5),
  '402': { ...pz(1, 12, 14), priceChanges: [{ monthsAgo: 4, priceCents: 3500 }] },
  '403': pz(1, 4, 6),
  '501': pz(1, 2, 3),
  '502': pz(1, 2, 3),
  '503': kg(0.25, 1.5, 250, 7, 'verduras'),
  '107': kg(0.25, 1.5, 250, 3),
  '108': pz(1, 2, 2, 'puerto'),
  '109': kg(0.5, 1.5, 250, 2),
  '110': kg(0.5, 2, 250, 4),
  '111': kg(0.5, 1.5, 250, 2),
  '112': kg(0.25, 1, 250, 5),
  '113': kg(0.25, 1, 250, 3, 'congeladora'),
  '204': kg(0.5, 1.5, 250, 3),
  '205': kg(0.5, 2.5, 250, 5),
  '206': kg(0.5, 1.5, 250, 3),
  '207': kg(0.25, 1, 250, 3, 'congeladora'),
  '208': kg(0.25, 0.75, 250, 2, 'congeladora'),
  '209': kg(0.5, 1.5, 250, 2),
  '303': { ...pz(1, 6, 8, null), priceChanges: [{ monthsAgo: 2, priceCents: 5000 }] },
  '304': pz(1, 2, 4, null),
  '305': pz(1, 2, 5, null),
  '306': pz(1, 3, 4, null),
  '307': { weight: 2, qtyMin: 800, qtyMax: 2000, step: 100, supplier: null },
  '404': pz(1, 4, 7),
  '405': pz(1, 3, 4, null),
  '406': { weight: 3, qtyMin: 500, qtyMax: 2000, step: 500, supplier: null },
  '407': pz(1, 12, 5),
  '504': pz(1, 2, 4),
  '505': pz(1, 2, 3),
  '506': pz(1, 1, 2),
  '507': kg(0.25, 1, 250, 3, 'verduras'),
  '508': kg(0.25, 1.5, 250, 4, 'verduras'),
  '509': pz(1, 3, 4, 'verduras'),
  '601': pz(1, 2, 2, 'congeladora'),
  '602': pz(1, 3, 2, 'congeladora'),
};

/** Segundo negocio (abarrotes), para la comparativa del superadmin. */
export const ESQUINA_PRODUCTS: ExtraProduct[] = [
  ['1001', 'Refresco de cola 2 l', 'Bebidas', 'pz', 4200, 3100, 48, 12, 1600],
  ['1002', 'Agua natural 1.5 l', 'Bebidas', 'pz', 1800, 1100, 60, 12, 1600],
  ['1003', 'Leche entera 1 l', 'Lácteos', 'pz', 2900, 2300, 40, 12, 0],
  ['1004', 'Huevo blanco (kg)', 'Básicos', 'kg', 5200, 4100, 15 * KG, 5 * KG, 0],
  ['1005', 'Tortilla de maíz (kg)', 'Básicos', 'kg', 2400, 1700, 20 * KG, 5 * KG, 0],
  ['1006', 'Frijol negro (kg)', 'Básicos', 'kg', 4400, 3300, 15 * KG, 4 * KG, 0],
  ['1007', 'Arroz (kg)', 'Básicos', 'kg', 3600, 2600, 15 * KG, 4 * KG, 0],
  ['1008', 'Pan blanco grande', 'Panadería', 'pz', 5200, 3900, 20, 6, 0],
  ['1009', 'Galletas surtidas', 'Botanas', 'pz', 2600, 1700, 30, 8, 1600],
  ['1010', 'Papas fritas 45 g', 'Botanas', 'pz', 2000, 1300, 40, 10, 1600],
  ['1011', 'Jabón de barra', 'Limpieza', 'pz', 2200, 1500, 25, 6, 1600],
  ['1012', 'Detergente 1 kg', 'Limpieza', 'pz', 4800, 3600, 18, 5, 1600],
];

export const ESQUINA_PROFILES: Record<string, DemandProfile> = {
  '1001': pz(1, 2, 10, 'esquina'),
  '1002': pz(1, 3, 6, 'esquina'),
  '1003': pz(1, 3, 8, 'esquina'),
  '1004': kg(0.5, 2, 250, 6, 'esquina'),
  '1005': kg(0.5, 2, 250, 9, 'esquina'),
  '1006': kg(0.5, 2, 500, 4, 'esquina'),
  '1007': kg(0.5, 2, 500, 4, 'esquina'),
  '1008': pz(1, 1, 5, 'esquina'),
  '1009': pz(1, 3, 4, 'esquina'),
  '1010': pz(1, 4, 6, 'esquina'),
  '1011': pz(1, 2, 2, 'esquina'),
  '1012': { ...pz(1, 1, 2, 'esquina'), priceChanges: [{ monthsAgo: 5, priceCents: 5200 }] },
};
