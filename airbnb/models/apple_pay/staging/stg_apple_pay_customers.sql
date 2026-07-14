{{ config(materialized='view', tags=['apple_pay']) }}

WITH source_data AS (
    SELECT *
    FROM {{ ref('seed_apple_pay_customers') }}
)

SELECT
    TRIM(CAST(customer_id AS VARCHAR))::VARCHAR(20) AS customer_id,
    NULLIF(TRIM(CAST(customer_name AS VARCHAR)), '')::VARCHAR(100) AS customer_name,
    UPPER(TRIM(CAST(customer_country AS VARCHAR)))::VARCHAR(2) AS customer_country,
    CAST(signup_at AS TIMESTAMP_NTZ) AS signup_at
FROM source_data
