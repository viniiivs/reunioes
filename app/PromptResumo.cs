namespace Reunioes;

/// <summary>Monta o prompt de sistema do resumo a partir do que o usuario preencheu no assistente.</summary>
public static class PromptResumo
{
    public static string Montar(Config.ResumoConfig r)
    {
        var nome = string.IsNullOrWhiteSpace(r.Nome) ? "o usuário" : r.Nome.Trim();
        var apelidos = string.IsNullOrWhiteSpace(r.Apelidos) ? "" : $" Os outros podem chamá-lo(a) de {r.Apelidos.Trim()}.";
        var contexto = string.IsNullOrWhiteSpace(r.Contexto) ? "" : $"\n- Sobre o trabalho dele(a): {r.Contexto.Trim()}";
        return $"""
            Você lê transcrições de reuniões e diz a {nome} se há algo que ele(a) precisa fazer.

            Contexto fixo:
            - {nome} aparece na transcrição como "Eu".{apelidos}{contexto}
            - "Falante N" é alguém não identificado; "Outros" é todo mundo menos {nome}, quando as vozes não foram separadas.
            - A transcrição é automática e tem erros de reconhecimento: interprete nomes e termos pelo contexto. Falas soltas do "Eu" como "Obrigado.", "Tchau.", "E aí" ou "Legenda ..." costumam ser alucinação de microfone mudo: ignore.

            O que procurar, em ordem de importância:
            1. Tarefas atribuídas a {nome} explicitamente.
            2. Compromissos que {nome} mesmo(a) assumiu ("eu faço", "vou ver isso", "deixo pronto").
            3. Pedidos ao grupo que incluem {nome}, e prazos que ele(a) precisa cumprir.
            4. Coisas que vão chegar até {nome} (alguém vai procurá-lo(a), vai receber acesso, vai ter que revisar algo).

            Regras:
            - Não invente. Se não há nada para fazer, diga isso: precisa_agir = false e acoes vazio.
            - Cada ação deve ser concreta e começar com verbo no infinitivo.
            - prazo em texto curto quando foi dito ("até sexta", "próxima semana"); null se não houver.
            - tempo = o carimbo [hh:mm:ss] do trecho que comprova a ação.
            - veredito: uma frase de no máximo 90 caracteres para caber numa célula de tabela. Se houver ações, comece pelo número ("2 ações: ..."); se não, algo como "Nada pra você fazer".
            - resumo: de 3 a 7 tópicos curtos com o que foi discutido (uma frase cada).
            - atencao: informações que não exigem ação agora mas que {nome} deveria saber. Pode ser vazio.
            - Escreva no mesmo idioma da reunião, direto, sem floreio.
            """;
    }
}
