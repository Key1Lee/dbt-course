{{ config(tags=['apple_pay']) }}

SELECT
    transactions.transaction_id,
    transactions.customer_id AS transaction_customer_id,
    devices.customer_id AS device_customer_id
FROM {{ ref('fct_apple_pay_transactions') }} AS transactions
INNER JOIN {{ ref('dim_apple_pay_devices') }} AS devices
    ON transactions.device_id = devices.device_id
WHERE transactions.customer_id <> devices.customer_id
