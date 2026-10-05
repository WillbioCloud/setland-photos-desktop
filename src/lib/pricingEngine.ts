export interface PackageDef {
  id: string;
  name: string;
  category: 'Avulsa' | 'Combo';
  price: number;
  req_printed: number;
  req_digital: number;
  active?: boolean;
}

export interface PricingResultItem {
  name: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface PricingResult {
  totalAmount: number;
  items: PricingResultItem[];
}

export function calculatePricing(
  printedCount: number,
  digitalCount: number,
  packages: PackageDef[]
): PricingResult {
  let remainingPrinted = printedCount;
  let remainingDigital = digitalCount;
  let totalAmount = 0;
  const items: PricingResultItem[] = [];

  // 1. Filtrar pacotes ativos e separar Combos de Avulsas
  const activePackages = packages.filter(p => p.active !== false);
  
  // Ordena os combos do maior para o menor (com proteção contra nulls caso o cache do Supabase falhe)
  const combos = activePackages
    .filter(p => p.category === 'Combo')
    .sort((a, b) => ((b.req_printed || 0) + (b.req_digital || 0)) - ((a.req_printed || 0) + (a.req_digital || 0)));

  const avulsas = activePackages.filter(p => p.category === 'Avulsa');
  
  // Busca dinamicamente os valores de referência com proteções de nulls
  const avulsaPrinted = avulsas.find(p => (p.req_printed || 0) > 0 || p.name.includes('Impressa')) 
    || { name: 'Foto Impressa (Avulsa)', price: 14, req_printed: 1, req_digital: 0 };
    
  const avulsaDigital = avulsas.find(p => (p.req_digital || 0) > 0 || p.name.includes('Digital')) 
    || { name: 'Foto Digital (Avulsa)', price: 7, req_printed: 0, req_digital: 1 };

  // 2. Aplicar os Combos (A Inteligência Gulosa)
  for (const combo of combos) {
    let maxFits = Infinity;
    const reqP = combo.req_printed || 0;
    const reqD = combo.req_digital || 0;

    // Ignora pacotes quebrados (ex: salvos no banco apenas com zeros devido a cache)
    if (reqP === 0 && reqD === 0) continue;
    
    if (reqP > 0) {
      maxFits = Math.min(maxFits, Math.floor(remainingPrinted / reqP));
    }
    if (reqD > 0) {
      maxFits = Math.min(maxFits, Math.floor(remainingDigital / reqD));
    }

    if (maxFits > 0 && maxFits !== Infinity) {
      remainingPrinted -= (reqP * maxFits);
      remainingDigital -= (reqD * maxFits);
      
      items.push({
        name: combo.name,
        quantity: maxFits,
        unitPrice: combo.price,
        subtotal: combo.price * maxFits
      });
      totalAmount += combo.price * maxFits;
    }
  }

  // 3. O que sobrou (Resto), cobrar como Avulsa
  if (remainingPrinted > 0) {
    const subtotal = remainingPrinted * Number(avulsaPrinted.price);
    items.push({
      name: avulsaPrinted.name,
      quantity: remainingPrinted,
      unitPrice: Number(avulsaPrinted.price),
      subtotal: subtotal
    });
    totalAmount += subtotal;
  }

  if (remainingDigital > 0) {
    const subtotal = remainingDigital * Number(avulsaDigital.price);
    items.push({
      name: avulsaDigital.name,
      quantity: remainingDigital,
      unitPrice: Number(avulsaDigital.price),
      subtotal: subtotal
    });
    totalAmount += subtotal;
  }

  return { totalAmount, items };
}
