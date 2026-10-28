export default function BancoNaoConfigurado({ detalhe }: { detalhe?: string }) {
  return (
    <section role="alert">
      <h2>Banco não configurado</h2>
      <p>{detalhe ?? "DATABASE_URL não configurada"}. Preencha o .env.local e reinicie o servidor.</p>
    </section>
  );
}
