{% macro drop_dev_schemas() %}

  {# Use the resolved target schema as the prefix (e.g. DBT_<env_name> on the dev target) #}
  {% set prefix = target.schema | upper %}
  {% set allowed_characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_' %}

  {# Safety guard: only drop dev schemas (prefixed DBT_), never PROD/STAGING #}
  {% if not prefix.startswith('DBT_') %}
    {{ exceptions.raise_compiler_error("Refusing to drop schemas: target.schema (" ~ prefix ~ ") is not a dev schema (must start with DBT_)") }}
  {% endif %}

  {# Prevent SQL/LIKE wildcard injection through a branch-derived environment name. #}
  {% for character in prefix %}
    {% if character not in allowed_characters %}
      {{ exceptions.raise_compiler_error(
        "Refusing to drop schemas: target.schema contains an unsupported character. "
        ~ "Use only letters, digits, and underscores."
      ) }}
    {% endif %}
  {% endfor %}

  {{ log(" * drop_dev_schemas: Looking for schemas with prefix:  " ~ prefix, info=True) }}

  {#
    Match the base schema itself or a custom schema separated by one underscore.
    A boundary check prevents DBT_ANN from matching DBT_ANNA, and avoids LIKE
    wildcard behavior for underscores in the target name.
  #}
  {% set prefix_length = prefix | length %}
  {% set schema_query %}
    SELECT schema_name
    FROM information_schema.schemata
    WHERE UPPER(schema_name) = '{{ prefix }}'
       OR (
         LEFT(UPPER(schema_name), {{ prefix_length }}) = '{{ prefix }}'
         AND SUBSTR(UPPER(schema_name), {{ prefix_length + 1 }}, 1) = '_'
       )
  {% endset %}
  {% set results = run_query(schema_query) %}

  {# Drop each matching schema #}
  {% if execute %}
    {% set schemas = results.columns[0].values() %}

    {% if schemas | length == 0 %}
      {{ log(" * drop_dev_schemas: No schemas found matching prefix: " ~ prefix, info=True) }}
    {% else %}
      {{ log(" * drop_dev_schemas: Found " ~ schemas | length ~ " schema(s) to drop:", info=True) }}
      {% for schema in schemas %}
        {{ log(" * drop_dev_schemas: Dropping: " ~ schema, info=True) }}
        {# Quote the warehouse-returned identifier before using it in DDL. #}
        {% do run_query("DROP SCHEMA IF EXISTS " ~ adapter.quote(schema) ~ " CASCADE") %}
      {% endfor %}
    {% endif %}

  {% endif %}

{% endmacro %}
