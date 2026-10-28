"use client";

import { useState } from "react";
import { adicionar, type ItemCarrinho } from "@/lib/carrinho";

export default function AdicionarAoPedido({ item }: { item: Omit<ItemCarrinho, "quantidade"> }) {
  const [quantidade, setQuantidade] = useState(1);
  const [aviso, setAviso] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        adicionar(item, quantidade);
        setAviso(`${quantidade} adicionado(s) ao pedido.`);
      }}
    >
      <label>
        Quantidade{" "}
        <input
          type="number"
          min={1}
          step={1}
          value={quantidade}
          onChange={(e) => setQuantidade(Math.max(1, Math.floor(Number(e.target.value)) || 1))}
        />
      </label>{" "}
      <button type="submit">Adicionar ao pedido</button>
      {aviso && <p role="status">{aviso}</p>}
    </form>
  );
}
