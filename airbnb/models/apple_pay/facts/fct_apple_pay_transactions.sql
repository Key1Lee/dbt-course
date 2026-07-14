{{
    config(
        materialized='incremental',
        unique_key='transaction_id',
        incremental_strategy='merge',
        on_schema_change='fail',
        event_time='transaction_ts',
        tags=['apple_pay']
    )
}}

WITH transactions AS (
    SELECT *
    FROM {{ ref('stg_apple_pay_transactions') }}
)

SELECT
    transaction_id,
    transaction_ts,
    CAST(transaction_ts AS DATE) AS transaction_date,
    customer_id,
    merchant_id,
    device_id,
    amount,
    currency,
    payment_channel,
    transaction_status,
    decline_reason,
    payment_network,
    card_type,
    CASE
        WHEN transaction_status IN ('authorized', 'settled', 'refunded') THEN TRUE
        ELSE FALSE
    END AS is_approved,
    CASE
        WHEN transaction_status = 'declined' THEN TRUE
        ELSE FALSE
    END AS is_declined,
    updated_at
FROM transactions
{% if is_incremental() %}
WHERE updated_at >= DATEADD(
    DAY,
    -3,
    (
        SELECT COALESCE(
            MAX(updated_at),
            CAST('1900-01-01' AS TIMESTAMP_NTZ)
        )
        FROM {{ this }}
    )
)
{% endif %}
