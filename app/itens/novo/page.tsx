"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import BancoNaoConfigurado from "@/app/_components/BancoNaoConfigurado";

const TIPOS = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

type Falha = { falha: string };

// Pede a URL assinada e faz o PUT direto no S3 (mesmo Content-Type da assinatura).
// Devolve a fotoKey, null se o S3 não está configurado (foto indisponível) ou { falha }.
async function enviarFoto(arquivo: File): Promise<string | null | Falha> {
  const res = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contentType: arquivo.type, tamanho: arquivo.size }),
  });
  if (res.status === 503) return null;
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) return { falha: dados.detalhes?.[0]?.mensagem ?? dados.erro ?? "erro ao pedir URL da foto" };
  const put = await fetch(dados.uploadUrl, {
    method: "PUT",
    headers: { "content-type": arquivo.type },
    body: arquivo,
  });
  if (!put.ok) return { falha: "falha ao enviar a foto (confira o CORS do bucket)" };
  return dados.fotoKey as string;
}

export default function NovoItemPage() {
  const router = useRouter();
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [semBanco, setSemBanco] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function salvar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const foto = f.get("foto");
    const arquivo = foto instanceof File && foto.size > 0 ? foto : null;
    setErro("");
    setAviso("");
    if (arquivo && !TIPOS.includes(arquivo.type)) return setErro("foto deve ser JPEG, PNG ou WebP");
    if (arquivo && arquivo.size > MAX_BYTES) return setErro("foto acima de 5 MB");
    setEnviando(true);
    try {
      let fotoKey: string | null = null;
      if (arquivo) {
        const r = await enviarFoto(arquivo);
        if (r !== null && typeof r === "object") return setErro(r.falha);
        fotoKey = r;
        if (r === null) setAviso("Foto indisponível (S3 não configurado): salvando sem foto.");
      }
      const res = await fetch("/api/itens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nome: f.get("nome"),
          descricao: f.get("descricao"),
          valor: f.get("valor"),
          fotoKey,
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
          <p>
            <label>
              Foto (opcional, até 5 MB) <input name="foto" type="file" accept={TIPOS.join(",")} />
            </label>
          </p>
          {aviso && <p role="status">{aviso}</p>}
          {erro && <p role="alert">{erro}</p>}
          <button type="submit" disabled={enviando}>
            Salvar
          </button>
        </form>
      )}
    </main>
  );
}
