// Meu perfil: dados de quem está usando, tema (claro, escuro ou do sistema) e cópia de segurança (só o dono).
import { useState } from "react";
import { Download, Monitor, Moon, Sun } from "lucide-react";
import { chamar } from "../api";
import { EMPRESA } from "../config/empresa";
import { aplicarTema, type Tema } from "../tema";
import { Aviso, Botao, Cabecalho, Cartao, Esqueleto, useAvisar, useDados, useFuncionario } from "../ui";

type Perfil = { nome: string; email: string; papel: "dono" | "funcionario"; tema: Tema };

const TEMAS: { valor: Tema; nome: string; descricao: string; icone: typeof Sun }[] = [
  { valor: "claro", nome: "Claro", descricao: "Fundo claro o tempo todo", icone: Sun },
  { valor: "escuro", nome: "Escuro", descricao: "Fundo escuro o tempo todo", icone: Moon },
  { valor: "sistema", nome: "Seguir o sistema", descricao: "Acompanha o celular ou computador", icone: Monitor },
];

export default function Perfil() {
  const funcionario = useFuncionario();
  const avisar = useAvisar();
  const { dados, erro, recarregar } = useDados<Perfil>("/api/perfil");
  const [salvando, setSalvando] = useState(false);
  const [baixando, setBaixando] = useState(false);

  async function escolher(tema: Tema) {
    aplicarTema(tema); // muda na hora; o banco guarda para os outros dispositivos
    setSalvando(true);
    const r = await chamar<Perfil>("/api/perfil", { tema }, "PATCH");
    setSalvando(false);
    if (!r.ok) return avisar(r.erro, "erro");
    void recarregar();
    avisar("Tema salvo no seu perfil.");
  }

  async function backup() {
    setBaixando(true);
    const r = await chamar("/api/backup");
    setBaixando(false);
    if (!r.ok) return avisar(r.erro, "erro");
    const url = URL.createObjectURL(new Blob([JSON.stringify(r.dados, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: `backup-${new Date().toISOString().slice(0, 10)}.json` }).click();
    URL.revokeObjectURL(url);
  }

  if (erro) return <Aviso msg={erro} />;
  if (!dados) return <Esqueleto linhas={3} />;
  return (
    <>
      <Cabecalho titulo="Meu perfil" descricao="Seus dados de acesso e preferências" />
      <div className="grid max-w-3xl gap-4">
        <Cartao titulo="Dados">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-suave">Nome</dt><dd className="font-medium">{dados.nome}</dd>
            <dt className="text-suave">E-mail</dt><dd>{dados.email}</dd>
            <dt className="text-suave">Acesso</dt><dd>{dados.papel === "dono" ? "Dono (acesso completo)" : "Funcionário (vendas, estoque e clientes)"}</dd>
            <dt className="text-suave">Empresa</dt><dd>{EMPRESA.nome}</dd>
          </dl>
        </Cartao>

        <Cartao titulo="Aparência" descricao="Salvo no seu perfil: vale em qualquer computador ou celular em que você entrar.">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Tema">
            {TEMAS.map(({ valor, nome, descricao, icone: Icone }) => {
              const marcado = dados.tema === valor;
              return (
                <button key={valor} type="button" role="radio" aria-checked={marcado} disabled={salvando} onClick={() => !marcado && escolher(valor)}
                  className={`flex items-start gap-3 rounded-md border p-3 text-left ${marcado ? "border-acento bg-acento-suave" : "border-borda hover:border-borda-forte hover:bg-cinza"}`}>
                  <Icone size={18} strokeWidth={1.75} className={marcado ? "text-acento" : "text-suave"} aria-hidden />
                  <span>
                    <span className="block text-sm font-medium">{nome}</span>
                    <span className="block text-xs text-suave">{descricao}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </Cartao>

        {!funcionario && (
          <Cartao titulo="Cópia de segurança" descricao="Baixa todos os dados da empresa num arquivo JSON.">
            <Botao icone={<Download size={16} aria-hidden />} onClick={backup} disabled={baixando}>{baixando ? "Gerando…" : "Baixar backup"}</Botao>
          </Cartao>
        )}
      </div>
    </>
  );
}
