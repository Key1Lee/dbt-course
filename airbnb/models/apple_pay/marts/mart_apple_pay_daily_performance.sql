{{ config(materialized='table', tags=['apple_pay']) }}

WITH transactions AS (
    SELECT *
    FROM {{ ref('fct_apple_pay_transactions') }}
),
daily_metrics AS (
    SELECT
        transaction_date,
        currency,
        payment_channel,
        COUNT(*) AS transaction_count,
        SUM(CASE WHEN is_approved = TRUE THEN 1 ELSE 0 END) AS approved_transaction_count,
        SUM(CASE WHEN is_declined = TRUE THEN 1 ELSE 0 END) AS declined_transaction_count,
        SUM(CASE WHEN transaction_status = 'refunded' THEN 1 ELSE 0 END) AS refunded_transaction_count,
        SUM(amount) AS requested_amount,
        SUM(CASE WHEN is_approved = TRUE THEN amount ELSE 0 END) AS approved_requested_amount,
        SUM(CASE WHEN transaction_status = 'refunded' THEN amount ELSE 0 END) AS refunded_requested_amount
    FROM transactions
    GROUP BY
        transaction_date,
        currency,
        payment_channel
)

SELECT
    transaction_date,
    currency,
    payment_channel,
    transaction_count,
    approved_transaction_count,
    declined_transaction_count,
    refunded_transaction_count,
    requested_amount,
    approved_requested_amount,
    refunded_requested_amount,
    ROUND(
        approved_transaction_count::NUMBER(18, 4)
        / NULLIF(transaction_count, 0),
        4
    ) AS approval_rate
FROM daily_metrics
