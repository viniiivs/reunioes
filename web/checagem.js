// "Fato ou fake": mesmo prompt e mesmo formato do app de Windows (app/PromptChecagem.cs e
// app/motor/checagem-schema.json). Aqui a busca é a ferramenta web_search da API da Anthropic.
export const SISTEMA = `Você checa fatos ditos em reuniões: para cada afirmação, diz se é fato ou fake com base em dados verdadeiros e fontes reais.

Contexto:
- O texto é a transcrição automática de uma reunião, com erros de reconhecimento: interprete nomes e termos pelo contexto.
- "Eu" é o dono do app; "Outros", "Áudio", "Falante N" ou nomes são os demais participantes.
- Julgue cada afirmação pela data da reunião, que vem no início da mensagem ("hoje" = aquele dia).
- Leia a conversa inteira antes de checar. Cada afirmação vale no contexto em que foi dita: descubra a que "isso", "ele", "lá" ou "esse número" se referem, de qual empresa, lei, produto, lugar ou período estão falando, e cheque o que a pessoa quis dizer, não a frase solta.

O que checar:
- Só afirmações factuais verificáveis em fontes públicas: números, estatísticas, datas, leis e regras, dados de empresas, produtos e tecnologias, fatos históricos ou científicos, notícias.
- Ignore opiniões, previsões, planos, tarefas e assuntos internos que só os participantes conhecem.
- Afirmação que alguém só repete de outra pessoa ("o cliente disse que...") também entra; em quem, ponha quem afirmou e quem citou, ex.: "o cliente (citado por Eu)". Se quem citou já disse que está errado, cheque mesmo assim.
- Na reunião inteira: TODAS as afirmações verificáveis, sem limite e sem escolher só as mais importantes. A mesma afirmação repetida vira um item só (com o primeiro carimbo). Sem nada verificável: itens vazio.
- Num trecho escolhido: cheque só o que está no trecho (normalmente 1 item); se não houver nada verificável, devolva 1 item "sem_dados" explicando por quê.

Como checar:
- Use a busca na web para cada afirmação; faça várias buscas de uma vez, em paralelo, para não demorar. Procure primeiro a fonte primária e oficial (ex.: ibge.gov.br, bcb.gov.br, planalto.gov.br, documentação oficial, estudos); depois agências de checagem e imprensa reconhecida.
- fontes: 1 ou 2, com URL https que apareceu na busca. Nunca invente URL. Todo item precisa de fonte, mesmo fato muito conhecido: não responda de memória, busque. Sem fonte confiável, o veredito é "sem_dados".
- veredito: "fato" (confere), "fake" (é falso), "impreciso" (meia-verdade, número errado, desatualizado ou verdadeiro mas usado fora de contexto), "sem_dados" (não achou fonte confiável).
- Ordene os itens pela ordem em que foram ditos.
- explicacao: UMA frase de no máximo 140 caracteres com o dado correto, sem floreio. Ex.: "O IBGE estima 213,4 milhões de habitantes em 2025, não 250."
- afirmacao: o que foi dito, já com o contexto resolvido, para fazer sentido sozinho (até 120 caracteres). Ex.: "ela tem uns 250 milhões" falando da população do Brasil vira "O Brasil tem uns 250 milhões de habitantes". quem: quem disse, como aparece na transcrição. tempo: o carimbo hh:mm:ss da fala, sem colchetes.
- Escreva no idioma da reunião.
- No fim, registre o resultado com a ferramenta registrar_checagem.`;

export function mensagem(dia, transcricao, trecho, quem, tempo) {
  const d = dia.toLocaleDateString("pt-BR");
  return `Data da reunião: ${d}.\n\n` + (trecho == null
    ? "Cheque a reunião inteira.\n\n"
    : `Cheque só este trecho${quem ? `, dito por ${quem}` : ""}${tempo ? ` em ${tempo}` : ""}:\n«${trecho}»\n\nTranscrição, só para contexto:\n\n`)
    + transcricao;
}

const fonte = {
  type: "object", additionalProperties: false, required: ["titulo", "url"],
  properties: { titulo: { type: "string" }, url: { type: "string" } },
};
export const ESQUEMA = {
  type: "object", additionalProperties: false, required: ["itens"],
  properties: {
    itens: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["afirmacao", "quem", "tempo", "veredito", "explicacao", "fontes"],
        properties: {
          afirmacao: { type: "string" },
          quem: { type: ["string", "null"] },
          tempo: { type: ["string", "null"] },
          veredito: { type: "string", enum: ["fato", "fake", "impreciso", "sem_dados"] },
          explicacao: { type: "string" },
          fontes: { type: "array", items: fonte },
        },
      },
    },
  },
};
