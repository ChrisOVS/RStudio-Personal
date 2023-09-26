source("C:/Users/Chris van Schalkwyk/Desktop/RStudio_GitHub/RStudio-Personal/ChatGPT_Experiments/01_PracticeProject/0.packages.R")


if(file.exists(file.path(paste0(data_path, "HousePriceData.csv")))){
  # read CSV file into a data frame
  data_df <- read_csv(paste0(data_path, "HousePriceData.csv"))
}else{
  # URL of the CSV file
  csv_url <- "https://data.ct.gov/api/views/5mzw-sjtu/rows.csv?accessType=DOWNLOAD"
  
  # Download and read the CSV file into a data frame
  data_df <- read_csv(csv_url)
}




