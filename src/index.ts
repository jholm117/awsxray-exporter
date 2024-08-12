import dgram from "dgram";
import {
  paginateBatchGetTraces,
  paginateGetTraceSummaries,
  Trace,
  XRayClient,
} from "@aws-sdk/client-xray";

const POLLING_INTERVAL =
  Number(process.env.POLLING_INTERVAL_SECONDS) * 1000 || 10000;
const OTEL_COLLECTOR_URL = process.env.OTEL_COLLECTOR_URL;
if (!OTEL_COLLECTOR_URL) {
  throw new Error("OTEL_COLLECTOR_URL environment variable is required");
}
const FILTER_EXPRESSION = process.env.FILTER_EXPRESSION;
const client = new XRayClient({ region: "us-east-2" });

async function fetchTraces() {
  const EndTime = new Date();
  const StartTime = new Date(EndTime.getTime() - POLLING_INTERVAL); // Fetch traces from the last 60 seconds

  try {
    for await (const traceSummaries of paginateGetTraceSummaries(
      { client },
      { StartTime, EndTime, FilterExpression: FILTER_EXPRESSION }
    )) {
      const traceIds = traceSummaries.TraceSummaries?.flatMap((trace) =>
        trace.Id ? [trace.Id] : []
      );

      if (!traceIds) {
        console.log("No trace IDs found");
        return;
      }

      // Generator function to yield chunks of specified size
      function* batchArray(array: any[], size: number) {
        for (let i = 0; i < array.length; i += size) {
          yield array.slice(i, i + size);
        }
      }

      console.log("Found", traceIds.length, "traces from xray");

      // BatchGetTraces supports a maximum of 5 trace IDs
      const batchedTraceIds = batchArray(traceIds, 5);
      for (const batch of batchedTraceIds) {
        for await (const traces of paginateBatchGetTraces(
          { client },
          {
            TraceIds: batch,
          }
        )) {
          traces.Traces?.forEach(sendTracesToOtelUdp);
        }
      }
      console.log("Sent", traceIds.length, "traces to OTel");
    }
  } catch (error) {
    console.error("Error fetching traces:", error);
  }
}

const dgramClient = dgram.createSocket("udp4");

function sendTracesToOtelUdp(traceData: Trace) {
  traceData.Segments?.forEach((trace) => {
    if (
      !trace.Document ||
      (JSON.parse(trace.Document) as XRayDocument).inferred
    )
      return;

    const message = Buffer.from(
      `{"format": "json", "version": 1}\n${trace.Document}`
    );
    dgramClient.send(
      message,
      0,
      message.length,
      2000,
      OTEL_COLLECTOR_URL,
      (err) => {
        if (err) {
          console.error("Error sending trace to daemon:", err);
        }
      }
    );
  });
}

async function main() {
  while (true) {
    console.log("Polling X-Ray for traces");
    await fetchTraces();
    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL)); // Wait for 60 seconds before fetching new traces
  }
}

// Graceful shutdown logic
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully...");
  dgramClient.close();
  client.destroy();
  process.exit(0);
});

main().catch((error) => console.error("Error in main:", error));

export type XRayDocument = {
  name: string;
  id: string;
  trace_id: string;
  start_time: number;
  inferred?: boolean;
  parent_id?: string;
  end_time?: number;
  in_progress?: boolean;
  annotations?: Record<string, any>;
  service?: {
    version?: string;
  };
  user?: string;
  origin?: string;
  metadata?: Record<string, any>;
  http?: {
    request?: {
      method?: string; // The request method. For example, GET. Optional.
      url?: string; // The full URL of the request. Optional.
      user_agent?: string; // The user agent string from the requester's client. Optional.
      client_ip?: string; // The IP address of the requester. Optional.
      x_forwarded_for?: boolean; // Indicates if the client_ip was read from an X-Forwarded-For header. Optional.
    };
    response?: {
      status?: number; // HTTP status of the response. Optional.
      content_length?: number; // Length of the response body in bytes. Optional.
    };
  }; // HTTP objects with information about the original HTTP request. Optional.
  aws?: {
    account_id?: string; // If your application sends segments to a different AWS account, record the ID of the account running your application. Optional.
    api_gateway: {
      account_id: string;
      rest_api_id: string;
      stage: string;
      request_id: string;
    };
    cloudwatch_logs?: {
      log_group?: string; // The CloudWatch Log Group name. Optional.
      arn?: string; // The CloudWatch Log Group ARN. Optional.
    }[]; // Array of objects that describe a single CloudWatch log group. Optional.
    ec2?: {
      instance_id?: string; // The instance ID of the EC2 instance. Optional.
      instance_size?: string; // The type of EC2 instance. Optional.
      ami_id?: string; // The Amazon Machine Image ID. Optional.
      availability_zone?: string; // The Availability Zone in which the instance is running. Optional.
    }; // Information about an Amazon EC2 instance. Optional.
    ecs?: {
      container?: string; // The hostname of your container. Optional.
      container_id?: string; // The full container ID of your container. Optional.
      container_arn?: string; // The ARN of your container instance. Optional.
    }; // Information about an Amazon ECS container. Optional.
    eks?: {
      pod?: string; // The hostname of your EKS pod. Optional.
      cluster_name?: string; // The EKS cluster name. Optional.
      container_id?: string; // The full container ID of your container. Optional.
    }; // Information about an Amazon EKS cluster. Optional.
    elastic_beanstalk?: {
      environment_name?: string; // The name of the environment. Optional.
      version_label?: string; // The name of the application version that is currently deployed to the instance that served the request. Optional.
      deployment_id?: number; // Number indicating the ID of the last successful deployment to the instance that served the request. Optional.
    }; // Information about an Elastic Beanstalk environment. Optional.
    xray?: {
      auto_instrumentation?: boolean; // Indicates whether auto-instrumentation was used. Optional.
      sdk_version?: string; // The version of SDK or agent being used. Optional.
      sdk?: string; // The type of SDK. Optional.
    }; // Metadata about the type and version of instrumentation used. Optional.
  };
  error?: boolean;
  throttle?: boolean;
  fault?: boolean;
  cause?: {
    working_directory?: string;
    exceptions?: {
      id: string;
      message?: string;
      type?: string;
      remote?: boolean;
      truncated?: boolean;
      skipped?: boolean;
      cause?: {
        id: string;
      };
    }[];
  };
  subsegments?: Subsegment[];
};

type Subsegment = {
  id: string; // A 64-bit identifier for the subsegment, unique among segments in the same trace, in 16 hexadecimal digits.
  name: string; // The logical name of the subsegment.
  start_time: number; // Time the subsegment was created, in floating point seconds in epoch time, accurate to milliseconds.
  end_time?: number; // Time the subsegment was closed, in floating point seconds in epoch time, accurate to milliseconds. Optional if in_progress is true.
  in_progress?: boolean; // Boolean that is set to true instead of specifying an end_time to record that a subsegment is started but is not complete.
  trace_id?: string; // Trace ID of the subsegment's parent segment. Required only if sending a subsegment separately.
  parent_id?: string; // Segment ID of the subsegment's parent segment. Required only if sending a subsegment separately.
  type?: string; // "subsegment". Required only if sending a subsegment separately.
  namespace?: string; // "aws" for AWS SDK calls; "remote" for other downstream calls. Optional.
  http?: {
    request?: {
      method?: string; // The request method. For example, GET. Optional.
      url?: string; // The full URL of the request. Optional.
      user_agent?: string; // The user agent string from the requester's client. Optional.
      client_ip?: string; // The IP address of the requester. Optional.
      traced?: boolean; // Indicates if the downstream call is to another traced service. Optional.
    };
    response?: {
      status?: number; // HTTP status of the response. Optional.
      content_length?: number; // Length of the response body in bytes. Optional.
    };
  }; // HTTP object with information about an outgoing HTTP call. Optional.
  aws?: {
    operation?: string; // The name of the API action invoked against an AWS service or resource. Optional.
    account_id?: string; // The ID of the account that owns the AWS resource that your application accessed. Optional.
    region?: string; // If the resource is in a region different from your application, record the region. Optional.
    request_id?: string; // Unique identifier for the request. Optional.
    queue_url?: string; // For operations on an Amazon SQS queue, the queue's URL. Optional.
    table_name?: string; // For operations on a DynamoDB table, the name of the table. Optional.
  }; // AWS object with information about the downstream AWS resource that your application called. Optional.
  error?: boolean; // Indicates if an error occurred. Optional.
  throttle?: boolean; // Indicates if a throttle occurred. Optional.
  fault?: boolean; // Indicates if a fault occurred. Optional.
  cause?: object; // Information about the exception that caused the error. Optional.
  annotations?: { [key: string]: any }; // Annotations object with key-value pairs that you want X-Ray to index for search. Optional.
  metadata?: { [key: string]: any }; // Metadata object with any additional data that you want to store in the segment. Optional.
  subsegments?: Subsegment[]; // Array of subsegment objects. Optional.
  precursor_ids?: string[]; // Array of subsegment IDs that identifies subsegments with the same parent that completed prior to this subsegment. Optional.
};
