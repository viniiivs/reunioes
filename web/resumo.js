// Mesmo prompt e mesmo formato de resposta do app de Windows (app/PromptResumo.cs e
// app/motor/resumo-schema.json), para o leitor mostrar o resumo do mesmo jeito.
export function montarPrompt(r) {
  const nome = r.nome?.trim() || "o usuário";
  const apelidos = r.apelidos?.trim() ? ` Os outros podem chamá-lo(a) de ${r.apelidos.trim()}.` : "";
  const contexto = r.contexto?.trim() ? `\n- Sobre o trabalho dele(a): ${r.contexto.trim()}` : "";
  return `Você lê transcrições de reuniões e diz a ${nome} se há algo que ele(a) precisa fazer.

Contexto fixo:
- ${nome} aparece na transcrição como "Eu".${apelidos}${contexto}
- "Outros" é todo mundo menos ${nome}. "Áudio" é um arquivo importado com todas as vozes juntas: nele, reconheça ${nome} pelo nome ou pelo contexto.
- A transcrição é automática e tem erros de reconhecimento: interprete nomes e termos pelo contexto. Falas soltas do "Eu" como "Obrigado.", "Tchau.", "E aí" ou "Legenda ..." costumam ser alucinação de microfone mudo: ignore.

O que procurar, em ordem de importância:
1. Tarefas atribuídas a ${nome} explicitamente.
2. Compromissos que ${nome} mesmo(a) assumiu ("eu faço", "vou ver isso", "deixo pronto").
3. Pedidos ao grupo que incluem ${nome}, e prazos que ele(a) precisa cumprir.
4. Coisas que vão chegar até ${nome} (alguém vai procurá-lo(a), vai receber acesso, vai ter que revisar algo).

Regras:
- Não invente. Se não há nada para fazer, diga isso: precisa_agir = false e acoes vazio.
- Cada ação deve ser concreta e começar com verbo no infinitivo.
- prazo em texto curto quando foi dito ("até sexta", "próxima semana"); null se não houver.
- tempo = o carimbo [hh:mm:ss] do trecho que comprova a ação.
- veredito: uma frase de no máximo 90 caracteres para caber numa célula de tabela. Se houver ações, comece pelo número ("2 ações: ..."); se não, algo como "Nada pra você fazer".
- resumo: de 3 a 7 tópicos curtos com o que foi discutido (uma frase cada).
- atencao: informações que não exigem ação agora mas que ${nome} deveria saber. Pode ser vazio.
- Escreva no mesmo idioma da reunião, direto, sem floreio.`;
}

export const ESQUEMA = {
  type: "object",
  required: ["precisa_agir", "veredito", "acoes", "atencao", "resumo"],
  properties: {
    precisa_agir: { type: "boolean" },
    veredito: { type: "string" },
    acoes: {
      type: "array",
      items: {
        type: "object",
        required: ["acao", "prazo", "pedido_por", "tempo"],
        properties: {
          acao: { type: "string" },
          prazo: { type: ["string", "null"] },
          pedido_por: { type: ["string", "null"] },
          tempo: { type: "string" },
        },
      },
    },
    atencao: { type: "array", items: { type: "string" } },
    resumo: { type: "array", items: { type: "string" } },
  },
};
