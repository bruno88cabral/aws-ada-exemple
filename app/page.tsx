import Link from "next/link";

export default function Home() {
  return (
    <main>
      <h1>Padaria</h1>
      <Link href="/itens">Catálogo</Link>
    </main>
  );
}
