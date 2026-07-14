{{ config(materialized='view', tags=['apple_pay']) }}

WITH source_data AS (
    SELECT *
    FROM {{ ref('seed_apple_pay_transactions') }}
)

SELECT
    TRIM(CAST(transaction_id AS VARCHAR))::VARCHAR(20) AS transaction_id,
    TRIM(CAST(customer_id AS VARCHAR))::VARCHAR(20) AS customer_id,
    TRIM(CAST(merchant_id AS VARCHAR))::VARCHAR(20) AS merchant_id,
    TRIM(CAST(device_id AS VARCHAR))::VARCHAR(20) AS device_id,
    CAST(transaction_ts AS TIMESTAMP_NTZ) AS transaction_ts,
    CAST(amount AS NUMBER(12, 2)) AS amount,
    UPPER(TRIM(CAST(currency AS VARCHAR)))::VARCHAR(3) AS currency,
    LOWER(TRIM(CAST(payment_channel AS VARCHAR)))::VARCHAR(20) AS payment_channel,
    LOWER(TRIM(CAST(transaction_status AS VARCHAR)))::VARCHAR(20) AS transaction_status,
    NULLIF(LOWER(TRIM(CAST(decline_reason AS VARCHAR))), '')::VARCHAR(100) AS decline_reason,
    UPPER(TRIM(CAST(payment_network AS VARCHAR)))::VARCHAR(30) AS payment_network,
    LOWER(TRIM(CAST(card_type AS VARCHAR)))::VARCHAR(20) AS card_type,
    CAST(updated_at AS TIMESTAMP_NTZ) AS updated_at
FROM source_data
