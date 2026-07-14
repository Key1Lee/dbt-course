{{ config(materialized='view', tags=['apple_pay']) }}

WITH source_data AS (
    SELECT *
    FROM {{ ref('seed_apple_pay_merchants') }}
)

SELECT
    TRIM(CAST(merchant_id AS VARCHAR))::VARCHAR(20) AS merchant_id,
    NULLIF(TRIM(CAST(merchant_name AS VARCHAR)), '')::VARCHAR(100) AS merchant_name,
    LOWER(TRIM(CAST(merchant_category AS VARCHAR)))::VARCHAR(50) AS merchant_category,
    UPPER(TRIM(CAST(merchant_country AS VARCHAR)))::VARCHAR(2) AS merchant_country
FROM source_data
