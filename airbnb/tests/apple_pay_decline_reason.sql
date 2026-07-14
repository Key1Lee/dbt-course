{{ config(tags=['apple_pay']) }}

SELECT *
FROM {{ ref('fct_apple_pay_transactions') }}
WHERE
    (
        transaction_status = 'declined'
        AND NULLIF(TRIM(decline_reason), '') IS NULL
    )
    OR (
        transaction_status <> 'declined'
        AND decline_reason IS NOT NULL
    )
