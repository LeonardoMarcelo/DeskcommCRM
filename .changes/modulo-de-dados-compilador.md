---
impacto: nada_mudou
secao: adicionado
titulo: A base para módulos que trazem dados próprios, declarados em vez de programados
---

O servidor passa a saber transformar a **descrição** das informações de um módulo — quais fichas ele guarda e quais campos cada ficha tem — nas tabelas correspondentes do banco, sem que o autor do módulo escreva uma linha de banco de dados. É a primeira peça da plataforma de módulos: ela permite que um módulo de nicho (odontograma de clínica, ficha de imóvel, cardápio) guarde informação de verdade, com as mesmas proteções de isolamento entre empresas que as tabelas do próprio produto têm.

Duas proteções ficam valendo desde já. As tabelas de módulo nascem **fechadas ao navegador**: nada nelas é alcançável direto, só pelas rotas do sistema, que registram quem fez o quê. E a ligação de uma ficha de módulo com um contato é conferida **junto com a empresa dona do contato**, de modo que um módulo não consegue apontar para o cliente de outra empresa na mesma instalação.

Nada muda na tela por enquanto: esta versão traz a base, e a instalação de módulos com dados aparece numa próxima. A atualização pode levar alguns segundos a mais uma única vez, porque o banco cria um índice novo na tabela de contatos.
