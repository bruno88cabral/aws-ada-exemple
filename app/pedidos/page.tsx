"use client";

import { useEffect, useState } from "react";
import BancoNaoConfigurado from "@/app/_components/BancoNaoConfigurado";
import { formatarCentavos } from "@/lib/dinheiro";
import type { Pedido } from "@/lib/pedidos";

const INTERVALO_MS = 2000;

const COR_STATUS: Record<string, { background: string; color: string }> = {
  recebido: { background: "#e5e7eb", color: "#374151" },
  confirmado: { background: "#dcfce7", color: "#166534" },
};

function StatusPill({ status }: { status: string }) {
  const cor = COR_STATUS[status] ?? COR_STATUS.recebido;
  return (
    <span data-status={status} style={{ ...cor, padding: "2px 10px", borderRadius: 999, fontSize: "0.85em" }}>
      {status}
    </span>
  );
}

export default function PedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[] | null>(null);
  const [semBanco, setSemBanco] = useState<string | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let ativo = true;
    async function buscar() {
      try {
        const res = await fetch("/api/pedidos", { cache: "no-store" });
        const dados = await res.json().catch(() => ({}));
        if (!ativo) return;
        if (res.status === 503) {
          setSemBanco(dados.erro ?? "");
        } else if (!res.ok) {
          setErro(dados.erro ?? "erro ao carregar pedidos");
        } else {
          setSemBanco(null);
          setErro("");
          setPedidos(dados.pedidos);
        }
      } catch {
        if (ativo) setErro("falha de rede");
      }
    }
    buscar();
    const timer = setInterval(buscar, INTERVALO_MS);
    return () => {
      ativo = false;
      clearInterval(timer);
    };
  }, []);

  return (
    <main>
      <h1>Pedidos</h1>
      {semBanco !== null ? (
        <BancoNaoConfigurado detalhe={semBanco || undefined} />
      ) : (
        <>
          {erro && <p role="alert">{erro}</p>}
          {pedidos === null ? (
            <p>Carregando...</p>
          ) : pedidos.length === 0 ? (
            <p>Nenhum pedido ainda.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {pedidos.map((p) => (
                  <tr key={p.id}>
                    <td title={p.id}>{p.id.slice(0, 8)}</td>
                    <td>{p.clienteNome}</td>
                    <td>{p.totalCents === null ? "-" : formatarCentavos(p.totalCents)}</td>
                    <td>
                      <StatusPill status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}
