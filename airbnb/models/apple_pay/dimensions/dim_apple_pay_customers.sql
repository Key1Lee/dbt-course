{{ config(materialized='table', tags=['apple_pay']) }}

WITH customers AS (
    SELECT *
    FROM {{ ref('stg_apple_pay_customers') }}
)

SELECT
    customer_id,
    customer_name,
    customer_country,
    signup_at
FROM customers
