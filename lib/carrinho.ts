// Carrinho no browser (localStorage). Só no client: no servidor tudo é no-op.
export type ItemCarrinho = {
  itemId: string;
  nome: string;
  valorCents: number; // só para exibição; o servidor congela o preço no checkout
  quantidade: number;
};

export const CHAVE_CARRINHO = "padaria:carrinho";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function listar(): ItemCarrinho[] {
  const s = storage();
  if (!s) return [];
  try {
    const dados: unknown = JSON.parse(s.getItem(CHAVE_CARRINHO) ?? "[]");
    if (!Array.isArray(dados)) return [];
    return dados.filter(
      (i): i is ItemCarrinho =>
        !!i &&
        typeof i.itemId === "string" &&
        typeof i.nome === "string" &&
        Number.isInteger(i.valorCents) &&
        Number.isInteger(i.quantidade) &&
        i.quantidade > 0,
    );
  } catch {
    return [];
  }
}

// Soma a quantidade se o item já está no carrinho. Ignora quantidade < 1.
export function adicionar(item: Omit<ItemCarrinho, "quantidade">, quantidade = 1): ItemCarrinho[] {
  const atual = listar();
  const qtd = Math.floor(quantidade);
  const s = storage();
  if (!s || !(qtd >= 1)) return atual;
  const existente = atual.find((i) => i.itemId === item.itemId);
  if (existente) existente.quantidade += qtd;
  else atual.push({ ...item, quantidade: qtd });
  s.setItem(CHAVE_CARRINHO, JSON.stringify(atual));
  return atual;
}

export function limpar(): void {
  storage()?.removeItem(CHAVE_CARRINHO);
}
