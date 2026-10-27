"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import BancoNaoConfigurado from "@/app/_components/BancoNaoConfigurado";

export default function NovoItemPage() {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [semBanco, setSemBanco] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setErro("");
    setEnviando(true);
    try {
      const res = await fetch("/api/itens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nome: f.get("nome"),
          descricao: f.get("descricao"),
          valor: f.get("valor"),
        }),
      });
      const dados = await res.json().catch(() => ({}));
      if (res.status === 503) return setSemBanco(dados.erro ?? "");
      if (!res.ok) {
        const det = Array.isArray(dados.detalhes) ? dados.detalhes.map((d: { mensagem: string }) => d.mensagem).join("; ") : "";
        return setErro(det || dados.erro || "erro ao salvar");
      }
      router.push("/itens");
    } catch {
      setErro("falha de rede");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <main>
      <h1>Novo item</h1>
      {semBanco !== null ? (
        <BancoNaoConfigurado detalhe={semBanco || undefined} />
      ) : (
        <form onSubmit={salvar}>
          <p>
            <label>
              Nome <input name="nome" required maxLength={120} />
            </label>
          </p>
          <p>
            <label>
              Descrição <textarea name="descricao" maxLength={1000} />
            </label>
          </p>
          <p>
            <label>
              Valor (R$) <input name="valor" required inputMode="decimal" placeholder="12,50" />
            </label>
          </p>
          {erro && <p role="alert">{erro}</p>}
          <button type="submit" disabled={enviando}>
            Salvar
          </button>
        </form>
      )}
    </main>
  );
}
