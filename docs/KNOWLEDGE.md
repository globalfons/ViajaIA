# Knowledge / RAG

## Uso
1. Platform Admin → Modelos: activa un modelo de tipo **embedding** que devuelva **1536 dimensiones** (o que admita el
   parámetro `dimensions`, como OpenAI `text-embedding-3-*` o Gemini con `outputDimensionality`).
2. **Knowledge → Nueva knowledge base** (elige el modelo de embeddings).
3. Sube documentos (PDF, DOCX, TXT, Markdown, CSV, HTML · 20 MB · hasta 20 a la vez) o añade URLs públicas (https).
4. El **worker** los indexa. La tabla muestra estado, tamaño, fragmentos, fecha y errores, y se actualiza sola.
5. **Probar búsqueda** muestra exactamente los fragmentos que recibiría un agente.
6. En el agente, marca la knowledge base en «Conocimiento». Las respuestas citan las fuentes como [n] y el playground
   las muestra.

## Pipeline
```
upload (Server Action / API) → validación (tipo por magic number, tamaño, límites del plan, duplicados por SHA-256)
  → Supabase Storage  <org>/<doc>/<fichero>  → job document.ingest
worker: parse (pdf.js vía pdf-parse · mammoth · PapaParse · HTML→texto) → chunking recursivo con solape y secciones
  → embeddings por lotes (LLM Router: coste y uso por tenant) → document_chunks (pgvector HNSW + tsvector GIN)
consulta: embedding de la pregunta → app.search_chunks(org, kbs, …) = vector top-30 ⊕ texto completo top-30 → RRF → top-k
  → contexto <untrusted> citado en el prompt del agente
```

## Seguridad
- La búsqueda filtra por organización **dentro** de la función SQL (no se puede olvidar el filtro); los fragmentos solo se
  pueden leer vía RLS o el *service role*.
- Las URLs pasan por `safeFetch` (solo HTTPS, IPs privadas bloqueadas en el momento de conectar, límite de tamaño).
- El contenido de los documentos se trata como no confiable (delimitado y analizado en busca de inyección).
- Ficheros con contenido que no coincide con su extensión: se rechazan (estado `failed` con el motivo).

## OCR (PDF escaneados e imágenes)

Si un PDF no tiene capa de texto o se sube una imagen (PNG, JPG o WEBP), la ingesta usa el **modelo de OCR** elegido en
Platform Admin → Configuración: cualquier modelo de chat activo que acepte imágenes o PDF (OpenAI, Anthropic o Gemini).
El fichero se envía al proveedor como adjunto nativo (`file`/`image_url`, `document`/`image` o `inline_data`) con la
instrucción de transcribir solo el texto. El contenido del documento se trata como datos, nunca como instrucciones.

- Solo se usa cuando no hay texto, con un máximo de 10 MB por fichero para OCR.
- El consumo se registra al cliente con el propósito `ocr` y está sujeto a sus límites de coste.
- Sin modelo configurado, el documento queda como `failed` con un mensaje claro y se puede reindexar después.
- En los metadatos del documento queda qué modelo hizo el OCR (`metadata.ocr`).
