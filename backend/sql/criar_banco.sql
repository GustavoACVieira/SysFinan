-- Cria o schema e o usuario da API. Rodar uma vez no MySQL Workbench, conectado como root.
-- Troque 'troque_esta_senha' pela senha do usuario (a mesma do DATABASE_URL em backend/.env).
-- As tabelas sao criadas pela propria API ao subir (banco.criar_tabelas).

CREATE DATABASE IF NOT EXISTS sysfinan
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS 'sysfinan'@'localhost' IDENTIFIED BY 'troque_esta_senha';
GRANT ALL PRIVILEGES ON sysfinan.* TO 'sysfinan'@'localhost';
FLUSH PRIVILEGES;
