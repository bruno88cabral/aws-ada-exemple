import { notFound } from "next/navigation";
import BancoNaoConfigurado from "@/app/_components/BancoNaoConfigurado";
import { ConfigAusenteError } from "@/lib/config";
import { formatarCentavos } from "@/lib/dinheiro";
import { buscarItem, type Item } from "@/lib/itens";
import { idSchema } from "@/lib/schemas";
import AdicionarAoPedido from "./AdicionarAoPedido";

export const dynamic = "force-dynamic";

export default async function ItemPage({ params }: PageProps<"/itens/[id]">) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  let item: Item | null;
  try {
    item = await buscarItem(id);
  } catch (err) {
    if (err instanceof ConfigAusenteError) {
      return (
        <main>
          <h1>Item</h1>
          <BancoNaoConfigurado detalhe={err.message} />
        </main>
      );
    }
    throw err;
  }
  if (!item) notFound();
  return (
    <main>
      <h1>{item.nome}</h1>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {item.fotoUrl ? <img src={item.fotoUrl} alt={item.nome} width={240} /> : <p aria-label="sem foto">[foto]</p>}
      <p>{item.descricao ?? "Sem descrição."}</p>
      <p>{formatarCentavos(item.valorCents)}</p>
      <AdicionarAoPedido item={{ itemId: item.id, nome: item.nome, valorCents: item.valorCents }} />
    </main>
  );
}
