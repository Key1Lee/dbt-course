{{ config(materialized='table', tags=['apple_pay']) }}

WITH merchants AS (
    SELECT *
    FROM {{ ref('stg_apple_pay_merchants') }}
)

SELECT
    merchant_id,
    merchant_name,
    merchant_category,
    merchant_country
FROM merchants
