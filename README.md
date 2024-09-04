# awsxray-exporter

This project is used to ship traces from AWS-Xray to and Opentelemetry Collector's awsxray receiver. The receiver accepts traces in the Xray format so this tool doesn't need to do any translation. Hopefully one day this polling functionality is baked into the awsxray-receiver, but until then this is helpful for correlating xray and otlp traces.
