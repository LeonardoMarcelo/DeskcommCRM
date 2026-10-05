---
impacto: nada_mudou
secao: corrigido
titulo: Abrir um link antigo do catálogo numa página que não existe mais leva direto à última página
---
Na tela de Produtos, abrir uma página que já não existe (um link antigo, ou a última página depois de apagarem os produtos dela) deveria levar à última página com produtos. Num catálogo com algumas centenas de produtos, a consulta dessa página inexistente demorava até estourar o tempo do banco, e a tela ficava presa no carregamento. Agora a tela mostra direto a última página que existe, com a mesma busca, e o endereço no navegador é corrigido em seguida. Não é preciso fazer nada na instalação.
