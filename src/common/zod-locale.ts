import { z } from 'zod';

// Mensajes de validación en español para todo el API. Los mensajes propios de cada esquema
// (p. ej. 'Máximo 20 caracteres') siguen teniendo prioridad; esto cubre los que no tienen uno.
z.config(z.locales.es());
