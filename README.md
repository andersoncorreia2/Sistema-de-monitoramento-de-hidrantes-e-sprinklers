# Sistema de Monitoramento de Hidrantes e Sprinklers 🚒🧯

![Tela Principal do Painel](imagens/painel.png)

![Painel de Gestão de Efetivo](imagens/gestao.png)

Um sistema de missão crítica projetado para o Corpo de Bombeiros, permitindo o monitoramento em tempo real de equipamentos de proteção contra incêndio urbanos e prediais, integrando simulação de sensores IoT, um painel de comando web responsivo e um banco de dados relacional.

## 🚀 Funcionalidades Principais

* Monitoramento georreferenciado ao vivo utilizando mapas dinâmicos (Leaflet.js).
* API Backend em Node.js protegida com autenticação via tokens JWT.
* Controle de Acesso (RBAC) com níveis de Operador, Supervisor e Comando.
* Painel Administrativo (CRUD) completo para a gestão do efetivo militar.
* Recuperação de senha segura via e-mail utilizando código de verificação temporal (MFA).
* Gêmeo Digital (Digital Twin) integrado para simulação de dados telemétricos (pressão, vazão e integridade).
* Geração instantânea de relatórios gerenciais em PDF e extração de dados em CSV.

## 🛠️ Tecnologias Empregadas

* **Frontend:** HTML5, CSS3, Vanilla JavaScript, Chart.js, Leaflet, jsPDF.
* **Backend:** Node.js, Express, JSON Web Tokens (JWT), Nodemailer.
* **Banco de Dados:** PostgreSQL.