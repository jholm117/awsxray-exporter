# awsxray-exporter

This project is used to ship traces from AWS X-Ray to and Opentelemetry Collector's awsxray receiver. The receiver accepts traces in the X-Ray format so this tool doesn't need to do any translation. Hopefully one day this polling functionality is baked into the awsxray-receiver, but until then this is helpful for correlating X-Ray and OTLP traces.
