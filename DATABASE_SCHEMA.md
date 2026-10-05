# Database Schema Audit (Supabase)

## Visão Geral
Tabelas públicas encontradas no banco atualizado:
- `clients`
- `employees`
- `orders`
- `packages`
- `photo_sessions`
- `session_photos`
- `system_settings`

---

## Dicionário de Dados Detalhado

### Tabela: `clients`
- `id` (uuid, NO NULL, Default: `uuid_generate_v4()`) - **PK**
- `created_at` (timestamptz, YES NULL, Default: `now()`)
- `name` (text, NO NULL)
- `cpf` (varchar, NO NULL)
- `phone` (varchar, YES NULL)

### Tabela: `employees`
- `id` (uuid, NO NULL, Default: `gen_random_uuid()`) - **PK**
- `created_at` (timestamptz, NO NULL, Default: `timezone('utc'::text, now())`)
- `name` (text, NO NULL)
- `role` (text, NO NULL)
- `status` (text, YES NULL, Default: `'Ativo'`)
- `pin` (text, YES NULL)
- `email` (text, YES NULL)
- `avatar_url` (text, YES NULL)

### Tabela: `orders`
- `id` (uuid, NO NULL, Default: `uuid_generate_v4()`) - **PK**
- `created_at` (timestamptz, YES NULL, Default: `now()`)
- `session_id` (uuid, NO NULL)
- `total_amount` (numeric, NO NULL)
- `payment_method` (varchar, NO NULL)
- `status` (varchar, NO NULL)
- `photographer_name` (text, YES NULL)

### Tabela: `packages`
- `id` (uuid, NO NULL, Default: `uuid_generate_v4()`) - **PK**
- `created_at` (timestamptz, YES NULL, Default: `now()`)
- `name` (text, NO NULL)
- `price` (numeric, NO NULL)
- `includes_digital` (boolean, NO NULL)
- `includes_printed` (integer, NO NULL)
- `category` (text, YES NULL)
- `description` (text, YES NULL)
- `active` (boolean, YES NULL, Default: `true`)

### Tabela: `photo_sessions`
- `id` (uuid, NO NULL, Default: `uuid_generate_v4()`) - **PK**
- `created_at` (timestamptz, YES NULL, Default: `now()`)
- `client_id` (uuid, YES NULL)
- `photographer_id` (uuid, YES NULL)
- `folder_path_drive` (text, YES NULL)
- `status` (varchar, NO NULL)
- `client_name` (text, YES NULL)
- `client_cpf` (text, YES NULL)
- `client_phone` (text, YES NULL)
- `photographer_name` (text, YES NULL)
- `cover_photo_url` (text, YES NULL)
- `access_token` (uuid, YES NULL, Default: `gen_random_uuid()`)
- `drive_status` (text, YES NULL, Default: `'pending'`)
- `drive_folder_id` (text, YES NULL)
- `expires_at` (timestamptz, YES NULL, Default: `(now() + '30 days'::interval)`)
- `local_cache_dir` (text, YES NULL)

### Tabela: `session_photos`
- `id` (uuid, NO NULL, Default: `gen_random_uuid()`) - **PK**
- `session_id` (uuid, NO NULL)
- `created_at` (timestamptz, NO NULL, Default: `timezone('utc'::text, now())`)
- `original_name` (text, NO NULL)
- `preview_url` (text, YES NULL)
- `drive_file_id` (text, YES NULL)
- `status` (text, YES NULL, Default: `'pending'`)
- `local_original_path` (text, YES NULL)

### Tabela: `system_settings`
- `id` (varchar, NO NULL, Default: `'default'`) - **PK**
- `created_at` (timestamptz, NO NULL, Default: `timezone('utc'::text, now())`)
- `updated_at` (timestamptz, NO NULL, Default: `timezone('utc'::text, now())`)
- `google_drive_folder_id` (text, YES NULL, Default: `'1A2b3C4d5E6f7G8h9I0jKlMnOpQrStUvWxYz'`)
- `whatsapp_api_url` (text, YES NULL)
- `whatsapp_instance` (text, YES NULL)
- `whatsapp_token` (text, YES NULL)
- `receipt_footer` (text, YES NULL, Default: `'Obrigado por visitar a Setland!...'`)

---

## Notas da Atualização (Auditoria Resolvida)

As discrepâncias mapeadas anteriormente foram **solucionadas** no banco de dados real e o schema foi alinhado ao código do Front-end:

1. **`photo_sessions` corrigida:** Todas as colunas esperadas pelo front-end (`client_name`, `client_cpf`, `access_token`, `local_cache_dir`, `cover_photo_url`, etc.) agora existem fisicamente na tabela. O erro fatal do Supabase sobre coluna inexistente foi sanado.
2. **`photographers` obsoleta removida:** A antiga tabela legada não aparece mais no schema atual. Tudo agora passa apenas por `employees`.
3. **Nova Tabela `system_settings`:** Introduzida com sucesso para gerenciar de forma dinâmica configurações de Drive, WhatsApp e PDV sem precisar de hardcode no front-end.
4. **`orders` flexível:** Adicionada coluna `photographer_name` como text para registrar o nome sem depender estritamente de joins em tabelas legadas.
