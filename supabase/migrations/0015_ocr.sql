-- OCR for scanned PDFs and images through a vision-capable model chosen by the platform admin.
alter table public.documents drop constraint documents_source_type_check;
alter table public.documents add constraint documents_source_type_check check (source_type in ('pdf', 'docx', 'txt', 'md', 'csv', 'html', 'url', 'image'));
-- "provider:model" of an enabled chat model with vision; null disables OCR.
alter table public.platform_settings add column ocr_model text check (ocr_model is null or ocr_model ~ '^[a-z]+:[A-Za-z0-9._:/-]+$');
