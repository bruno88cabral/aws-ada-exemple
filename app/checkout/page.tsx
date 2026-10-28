"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import BancoNaoConfigurado from "@/app/_components/BancoNaoConfigurado";
import { limpar, listar, type ItemCarrinho } from "@/lib/carrinho";
import { formatarCentavos } from "@/lib/dinheiro";

export default function CheckoutPage() {
  const router = useRouter();
  // null até montar: o servidor não conhece o localStorage (evita mismatch de hidratação).
  const [itens, setItens] = useState<ItemCarrinho[] | null>(null);
  const [erro, setErro] = useState("");
  const [semBanco, setSemBanco] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pedidoId, setPedidoId] = useState("");

  useEffect(() => {
    // Lê o localStorage só depois de montar (assíncrono: setState direto no effect é proibido pelo lint).
    let ativo = true;
    queueMicrotask(() => {
      if (ativo) setItens(listar());
    });
    return () => {
      ativo = false;
    };
  }, []);

  const carrinho = itens ?? [];
  const total = carrinho.reduce((s, i) => s + i.valorCents * i.quantidade, 0);

  async function finalizar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErro("");
    setEnviando(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nome: f.get("nome"),
          email: f.get("email"),
          itens: carrinho.map((i) => ({ itemId: i.itemId, quantidade: i.quantidade })),
        }),
      });
      const dados = await res.json().catch(() => ({}));
      if (res.status === 503) return setSemBanco(dados.erro ?? "");
      if (!res.ok) {
        const det = Array.isArray(dados.detalhes) ? dados.detalhes.map((d: { mensagem: string }) => d.mensagem).join("; ") : "";
        return setErro(det || dados.erro || "erro ao finalizar");
      }
      setPedidoId(dados.pedidoId);
      limpar();
      setItens([]);
      router.push("/pedidos");
    } catch {
      setErro("falha de rede");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main>
      <h1>Checkout</h1>
      {pedidoId && (
        <p role="status">
          Pedido <strong>{pedidoId}</strong> recebido.
        </p>
      )}
      {semBanco !== null ? (
        <BancoNaoConfigurado detalhe={semBanco || undefined} />
      ) : (
        !pedidoId && (
          <>
            {itens === null ? (
              <p>Carregando carrinho...</p>
            ) : carrinho.length === 0 ? (
              <p>
                Carrinho vazio. <Link href="/itens">Ver itens</Link>
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qtd</th>
                    <th>Unitário</th>
                    <th>Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {carrinho.map((i) => (
                    <tr key={i.itemId}>
                      <td>{i.nome}</td>
                      <td>{i.quantidade}</td>
                      <td>{formatarCentavos(i.valorCents)}</td>
                      <td>{formatarCentavos(i.valorCents * i.quantidade)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Total</td>
                    <td>{formatarCentavos(total)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
            <form onSubmit={finalizar}>
              <p>
                <label>
                  Nome <input name="nome" required maxLength={120} />
                </label>
              </p>
              <p>
                <label>
                  E-mail <input name="email" type="email" required maxLength={254} />
                </label>
              </p>
              {erro && <p role="alert">{erro}</p>}
              <button type="submit" disabled={carrinho.length === 0 || enviando}>
                Finalizar pedido
              </button>
            </form>
          </>
        )
      )}
    </main>
  );
}
