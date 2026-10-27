import Link from "next/link";
import BancoNaoConfigurado from "@/app/_components/BancoNaoConfigurado";
import { ConfigAusenteError } from "@/lib/config";
import { formatarCentavos } from "@/lib/dinheiro";
import { listarItens, type Item } from "@/lib/itens";

// Lê o banco a cada request; nunca no build.
export const dynamic = "force-dynamic";

export default async function ItensPage() {
  let itens: Item[];
  try {
    itens = await listarItens();
  } catch (err) {
    if (err instanceof ConfigAusenteError) {
      return (
        <main>
          <h1>Catálogo</h1>
          <BancoNaoConfigurado detalhe={err.message} />
        </main>
      );
    }
    throw err;
  }
  return (
    <main>
      <h1>Catálogo</h1>
      <p>
        <Link href="/itens/novo">Novo item</Link>
      </p>
      {itens.length === 0 ? (
        <p>Nenhum item cadastrado.</p>
      ) : (
        <ul>
          {itens.map((i) => (
            <li key={i.id}>
              <Link href={`/itens/${i.id}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {i.fotoUrl ? <img src={i.fotoUrl} alt={i.nome} width={64} height={64} /> : <span aria-label="sem foto">[foto]</span>}{" "}
                {i.nome} · {formatarCentavos(i.valorCents)}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
